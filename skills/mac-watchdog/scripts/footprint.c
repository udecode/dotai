// Prints "pid ppid footprint_bytes rss_bytes comm" for every process this user can read.
// proc_pid_rusage is what top's MEM column uses; RSS alone misses compressed and swapped pages.
#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/proc_info.h>
#include <sys/resource.h>

int main(void) {
  int n = proc_listallpids(NULL, 0);
  if (n <= 0) return 1;
  pid_t *pids = calloc((size_t)n + 64, sizeof(pid_t));
  n = proc_listallpids(pids, (int)((n + 64) * sizeof(pid_t)));
  for (int i = 0; i < n; i++) {
    struct rusage_info_v2 ru;
    if (proc_pid_rusage(pids[i], RUSAGE_INFO_V2, (rusage_info_t *)&ru) != 0) continue;
    struct proc_bsdshortinfo bi;
    int ppid = -1;
    char comm[MAXCOMLEN + 1] = "?";
    if (proc_pidinfo(pids[i], PROC_PIDT_SHORTBSDINFO, 0, &bi, sizeof bi) == sizeof bi) {
      ppid = (int)bi.pbsi_ppid;
      snprintf(comm, sizeof comm, "%s", bi.pbsi_comm);
    }
    printf("%d %d %llu %llu %s\n", pids[i], ppid, ru.ri_phys_footprint, ru.ri_resident_size, comm);
  }
  free(pids);
  return 0;
}
