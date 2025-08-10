# Technical Debt Hunter

Ruthlessly hunt down technical debt, code quality issues, and lazy implementations using the hybrid AI+Computer operations pattern.

## Description

Scans the codebase for technical debt patterns using programmatic detection (ripgrep), then provides intelligent analysis and prioritized recommendations for cleanup.

**Hybrid Pattern**: CLI handles consistent pattern scanning, AI provides expert analysis and cleanup strategies.

## Detection Patterns

### Basic Technical Debt

- **TODO/FIXME comments** - Incomplete work markers
- **Console debug logs** - Debug artifacts left in code
- **Not implemented functions** - Empty or placeholder implementations
- **Commented code blocks** - Dead code that should be removed
- **Generic variable names** - Lazy naming (data, item, thing, stuff)
- **Empty functions** - Functions with no implementation
- **Debugger statements** - Breakpoints left in production code
- **AI naming patterns** - Similar function names (handle*, process*, manage\*)

### Duplicate Function Detection (Limited Heuristics)

- **Exact duplicates** - MD5 hash comparison of function signatures
- **Similar names** - AI-generated patterns like handleData/processData/manageData
- **Near-duplicates** - 80%+ text similarity in function bodies
- **⚠️ Limitations**: Cannot detect semantic similarity or refactored duplicates

## Usage

```bash
/fb:debt-hunter [scan_focus]
```

**Examples:**

- `/fb:debt-hunter` - Full technical debt scan and analysis
- `/fb:debt-hunter high-priority` - Focus on high-severity issues only
- `/fb:debt-hunter duplicates` - Focus on duplicate function detection
- `/fb:debt-hunter comprehensive` - Run both basic patterns and duplicate detection

**CLI Commands Available:**

- `flashback debt-hunter --scan` - Basic technical debt patterns
- `flashback debt-hunter --duplicates` - Duplicate/similar function detection (realistic heuristics only)
- `flashback debt-hunter --context` - Output structured context for AI analysis

## Output Format

1. **Executive Summary** - Overall code quality assessment
2. **Critical Issues** - High-priority problems requiring immediate attention
3. **Duplicate Analysis** - Assessment of function duplication (if requested)
4. **Remediation Plan** - Specific actions with file paths and line numbers
5. **Prevention Strategy** - Coding standards and practices to prevent future debt

## AI Analysis Focus

- Prioritize issues by impact on maintainability
- Identify patterns indicating architectural problems
- Provide specific, actionable fixes with file locations
- Suggest preventive measures and code quality practices

---

!`bash -c 'set -- $ARGUMENTS; focus="$1"; case "$focus" in
  "high-priority"|"critical") flashback debt-hunter --scan && echo "**Focus: High-priority issues only**" ;;
  "duplicates") flashback debt-hunter --duplicates && echo "**Focus: Duplicate function detection**" ;;
  "comprehensive") flashback debt-hunter --scan && echo "" && flashback debt-hunter --duplicates && echo "**Analysis: Comprehensive scan complete**" ;;
  *) flashback debt-hunter --scan && echo "**Analysis: Basic technical debt scan**" ;;
esac'`
