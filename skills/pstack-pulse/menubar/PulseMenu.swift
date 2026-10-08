import AppKit

struct Action: Decodable { let title: String; let url: String }
struct Chip: Decodable { let title: String; let color: String }
struct Metric: Decodable { let label: String; let value: String; let color: String }
struct Face: Decodable {
  let title: String
  let subtitle: String?
  let message: String?
  let color: String?
  let badge: Chip?
  let numberOfSteps: Int?
  let currentStep: Int?
  let metrics: [Metric]?
}
struct Card: Decodable { let key: String; let state: String; let contentState: Face; let open: String?; let page: String? }
struct Fleet: Decodable { let contentState: Face; let action: Action? }
struct Board: Decodable { let fleet: Fleet?; let cards: [Card] }

let home = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".pstack-pulse")
let openable: Set<String> = ["https", "claude", "chatgpt"]
// A headless claude -p has no session tools, so this opens a new desktop Code session with the request typed in.
let connectAllPrompt = "Turn on Remote Control for every non-archived Claude Code session: list them with list_sessions (limit 100) and call set_remote_control with enabled true on each one whose remoteControlActive is false. Reply with how many you turned on and which ones refused."

func connectAllURL() -> URL? {
  var parts = URLComponents(string: "claude://code/new")
  parts?.queryItems = [URLQueryItem(name: "q", value: connectAllPrompt), URLQueryItem(name: "folder", value: home.path)]
  return parts?.url
}

func boardURL() -> URL? {
  guard let data = try? Data(contentsOf: home.appendingPathComponent("config.json")),
    let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
    let port = config["listPort"] as? Int, let secret = config["secret"] as? String
  else { return nil }
  return URL(string: "http://127.0.0.1:\(port)/\(secret)/board.json")
}

func tint(_ name: String?) -> NSColor {
  switch name {
  case "orange": .systemOrange
  case "red": .systemRed
  case "green": .systemGreen
  case "purple": .systemPurple
  case "yellow": .systemYellow
  case "gray": .systemGray
  default: .systemBlue
  }
}

func clipped(_ text: String) -> String { text.count > 90 ? "\(text.prefix(89))…" : text }

func styled(_ text: String, size: CGFloat = 12, weight: NSFont.Weight = .regular, color: NSColor = .labelColor) -> NSAttributedString {
  NSAttributedString(string: text, attributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color])
}

func lines(_ parts: [[NSAttributedString]]) -> NSAttributedString {
  let text = NSMutableAttributedString()
  for (index, line) in parts.enumerated() {
    if index > 0 { text.append(styled("\n")) }
    line.forEach(text.append)
  }
  return text
}

func fleetText(_ face: Face) -> NSAttributedString {
  var metrics: [NSAttributedString] = []
  for (index, metric) in (face.metrics ?? []).enumerated() {
    if index > 0 { metrics.append(styled(" · ", size: 11, color: .secondaryLabelColor)) }
    metrics.append(styled("\(metric.label) ", size: 11, color: .secondaryLabelColor))
    metrics.append(styled(metric.value, size: 11, weight: .semibold, color: tint(metric.color)))
  }
  var parts = [[styled(face.title, size: 13, weight: .semibold)], metrics]
  if let subtitle = face.subtitle, !subtitle.isEmpty { parts.append([styled(clipped(subtitle), size: 11, color: .secondaryLabelColor)]) }
  return lines(parts)
}

func cardText(_ face: Face) -> NSAttributedString {
  var head = [styled("● ", size: 13, color: tint(face.color)), styled(clipped(face.title), size: 13, weight: .semibold)]
  if let badge = face.badge { head.append(styled("   \(badge.title)", size: 11, weight: .medium, color: tint(badge.color))) }
  var parts = [head]
  if let detail = face.message ?? face.subtitle, !detail.isEmpty { parts.append([styled(clipped(detail), size: 11, color: .secondaryLabelColor)]) }
  if let total = face.numberOfSteps, let current = face.currentStep, total > 1 {
    let done = min(max(current, 0), total)
    parts.append([
      styled(String(repeating: "▰", count: done) + String(repeating: "▱", count: total - done), size: 11, color: tint(face.color)),
      styled("  \(current)/\(total)", size: 11, color: .secondaryLabelColor),
    ])
  }
  return lines(parts)
}

@MainActor
final class Pulse: NSObject, NSApplicationDelegate, NSMenuDelegate {
  let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
  let menu = NSMenu()
  let dump: Bool
  var board: Board?
  let decoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.keyDecodingStrategy = .convertFromSnakeCase
    return decoder
  }()

  init(dump: Bool) {
    self.dump = dump
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    menu.delegate = self
    item.menu = menu
    renderButton()
    poll()
    Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { _ in
      MainActor.assumeIsolated { self.poll() }
    }
    Timer.scheduledTimer(withTimeInterval: 3, repeats: false) { _ in
      MainActor.assumeIsolated {
        let window = self.item.button?.window
        print("status item: frame=\(window?.frame ?? .zero) shown=\(window?.occlusionState.contains(.visible) ?? false)")
        fflush(stdout)
        if self.dump { self.dumpAndQuit() }
      }
    }
  }

  func poll() {
    Task {
      var next: Board?
      if let url = boardURL(), let response = try? await URLSession.shared.data(for: URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 2)) {
        next = try? decoder.decode(Board.self, from: response.0)
      }
      board = next
      renderButton()
    }
  }

  func count(_ state: String) -> Int { board?.cards.filter { $0.state == state }.count ?? 0 }

  func renderButton() {
    guard let button = item.button else { return }
    let (symbol, number, color): (String, Int, NSColor?) =
      board == nil ? ("bolt.slash", 0, nil)
      : count("needs-you") > 0 ? ("exclamationmark.bubble.fill", count("needs-you"), .systemOrange)
      : count("failed") > 0 ? ("xmark.octagon.fill", count("failed"), .systemRed)
      : count("working") > 0 ? ("bolt.fill", count("working"), nil)
      : ("moon.zzz", 0, nil)
    var image = NSImage(systemSymbolName: symbol, accessibilityDescription: "pstack sessions")
    if let color { image = image?.withSymbolConfiguration(NSImage.SymbolConfiguration(paletteColors: [color])) }
    image?.isTemplate = color == nil
    button.image = image
    button.imagePosition = .imageLeading
    button.title = number > 0 ? " \(number)" : ""
    button.toolTip = board == nil ? "pstack-pulse daemon not reachable" : "\(count("working")) working · \(count("needs-you")) need you · \(count("failed")) failed"
  }

  func row(_ title: NSAttributedString, opens action: Action?) -> NSMenuItem {
    let row = NSMenuItem(title: title.string, action: #selector(open(_:)), keyEquivalent: "")
    row.attributedTitle = title
    row.target = self
    row.representedObject = action?.url
    row.toolTip = action?.title
    return row
  }

  @objc func open(_ sender: NSMenuItem) {
    guard let link = sender.representedObject as? String, let url = URL(string: link), openable.contains(url.scheme ?? "") else { return }
    NSWorkspace.shared.open(url)
  }

  func menuNeedsUpdate(_ menu: NSMenu) {
    menu.removeAllItems()
    defer {
      menu.addItem(row(styled("Connect all sessions to Remote Control…"), opens: connectAllURL().map { Action(title: "Connect all sessions", url: $0.absoluteString) }))
      menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
    }
    guard let board else {
      menu.addItem(row(lines([[styled("pstack-pulse daemon not reachable", size: 13, weight: .semibold)], [styled("Run pulse.mjs doctor", size: 11, color: .secondaryLabelColor)]]), opens: nil))
      return
    }
    if let fleet = board.fleet { menu.addItem(row(fleetText(fleet.contentState), opens: fleet.action)) }
    menu.addItem(.separator())
    if board.cards.isEmpty { menu.addItem(row(styled("No live sessions", color: .secondaryLabelColor), opens: nil)) }
    for card in board.cards {
      menu.addItem(row(cardText(card.contentState), opens: card.open.map { Action(title: "Open session", url: $0) }))
      if let page = card.page {
        let extra = row(styled("↳ Plan", size: 11, color: .linkColor), opens: Action(title: "Plan", url: page))
        extra.indentationLevel = 1
        menu.addItem(extra)
      }
    }
    menu.addItem(.separator())
  }

  func dumpAndQuit() {
    menuNeedsUpdate(menu)
    for entry in menu.items {
      let text = entry.isSeparatorItem ? "---" : entry.attributedTitle?.string.replacingOccurrences(of: "\n", with: " | ") ?? entry.title
      print(String(repeating: "  ", count: entry.indentationLevel) + text + ((entry.representedObject as? String).map { " -> \($0)" } ?? ""))
    }
    NSApp.terminate(nil)
  }
}

MainActor.assumeIsolated {
  let app = NSApplication.shared
  app.setActivationPolicy(.accessory)
  let pulse = Pulse(dump: CommandLine.arguments.contains("--dump"))
  app.delegate = pulse
  app.run()
}
