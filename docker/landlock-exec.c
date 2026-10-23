/* landlock-exec: run a command that can only open files below the allowed paths (Linux Landlock, unprivileged).
 *   landlock-exec RO_PATHS RW_PATHS -- command [args...]
 * RO_PATHS / RW_PATHS: colon separated; RO = read + execute, RW = read + write + create + delete. Everything else
 * cannot be opened (EACCES). A path that does not exist is skipped. Fails closed: if Landlock is not available, the
 * command is NOT run (exit 126). */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

/* syscall numbers are the same on all architectures (Linux 5.13+); older libc headers may lack them */
#ifndef SYS_landlock_create_ruleset
#define SYS_landlock_create_ruleset 444
#endif
#ifndef SYS_landlock_add_rule
#define SYS_landlock_add_rule 445
#endif
#ifndef SYS_landlock_restrict_self
#define SYS_landlock_restrict_self 446
#endif

#define RO (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR)
#define RW (RO | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE | \
            LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG | LANDLOCK_ACCESS_FS_MAKE_SYM)
#define ALL (RW | LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | \
             LANDLOCK_ACCESS_FS_MAKE_BLOCK)

static int add(int rs, char *list, __u64 access) {
    for (char *p = strtok(list, ":"); p; p = strtok(NULL, ":")) {
        if (!*p) continue;
        int fd = open(p, O_PATH | O_CLOEXEC);
        if (fd < 0) continue;
        struct landlock_path_beneath_attr pb = {.allowed_access = access, .parent_fd = fd};
        struct stat st;
        if (fstat(fd, &st) == 0 && !S_ISDIR(st.st_mode))  /* a single file: only file rights */
            pb.allowed_access &= LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_WRITE_FILE;
        if (syscall(SYS_landlock_add_rule, rs, LANDLOCK_RULE_PATH_BENEATH, &pb, 0)) {
            fprintf(stderr, "landlock-exec: add %s: %s\n", p, strerror(errno));
            return -1;
        }
        close(fd);
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 5 || strcmp(argv[3], "--")) {
        fprintf(stderr, "usage: landlock-exec RO_PATHS RW_PATHS -- command [args...]\n");
        return 126;
    }
    struct landlock_ruleset_attr ra = {.handled_access_fs = ALL};
    int rs = syscall(SYS_landlock_create_ruleset, &ra, sizeof(ra), 0);
    if (rs < 0) {
        fprintf(stderr, "landlock-exec: Landlock not available: %s\n", strerror(errno));
        return 126;
    }
    if (add(rs, argv[1], RO) || add(rs, argv[2], RW)) return 126;
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || syscall(SYS_landlock_restrict_self, rs, 0)) {
        fprintf(stderr, "landlock-exec: restrict: %s\n", strerror(errno));
        return 126;
    }
    close(rs);
    execvp(argv[4], argv + 4);
    fprintf(stderr, "landlock-exec: exec %s: %s\n", argv[4], strerror(errno));
    return 127;
}
