/*
 * htk-getenv — macOS helper to read an environment variable from another process.
 *
 * Usage: htk-getenv <pid> <var_name>
 * Output: Prints the value (without key= prefix) to stdout and exits 0.
 * Exit 1: Variable not found, process not found, or permission denied.
 *
 * Mechanism: sysctl(KERN_PROCARGS2) returns the initial process arguments
 * and environment. Node's `delete process.env.X` only removes from the V8
 * heap — the kernel's copy is immutable.
 *
 * Security: Only same-user processes are readable (enforced by the kernel).
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <pid> <var_name>\n", argv[0]);
        return 1;
    }

    pid_t pid = (pid_t)atoi(argv[1]);
    const char *var_name = argv[2];
    size_t var_name_len = strlen(var_name);

    if (pid <= 0) {
        return 1;
    }

    /* First call: get required buffer size */
    int mib[3] = { CTL_KERN, KERN_PROCARGS2, pid };
    size_t size = 0;
    if (sysctl(mib, 3, NULL, &size, NULL, 0) != 0) {
        return 1;  /* Process not found or permission denied */
    }

    char *buf = malloc(size);
    if (!buf) {
        return 1;
    }

    /* Second call: read the actual data */
    if (sysctl(mib, 3, buf, &size, NULL, 0) != 0) {
        free(buf);
        return 1;
    }

    /*
     * KERN_PROCARGS2 layout:
     *   int argc
     *   exec_path\0
     *   padding nulls
     *   argv[0]\0 argv[1]\0 ... argv[argc-1]\0
     *   padding nulls
     *   env[0]\0 env[1]\0 ... env[n]\0
     */

    char *end = buf + size;
    char *p = buf;

    /* Read argc */
    if (p + sizeof(int) > end) {
        free(buf);
        return 1;
    }
    int nargs;
    memcpy(&nargs, p, sizeof(int));
    p += sizeof(int);

    /* Skip exec_path */
    while (p < end && *p != '\0') p++;
    if (p >= end) { free(buf); return 1; }
    p++; /* past the null */

    /* Skip padding nulls after exec_path */
    while (p < end && *p == '\0') p++;

    /* Skip argv strings */
    for (int i = 0; i < nargs && p < end; i++) {
        while (p < end && *p != '\0') p++;
        if (p < end) p++; /* past the null */
    }

    /* Skip any padding nulls between argv and envp */
    while (p < end && *p == '\0') p++;

    /* Now iterate environment strings */
    while (p < end && *p != '\0') {
        size_t entry_len = strnlen(p, (size_t)(end - p));

        /* Check if this entry matches "VAR_NAME=..." */
        if (entry_len > var_name_len &&
            p[var_name_len] == '=' &&
            memcmp(p, var_name, var_name_len) == 0)
        {
            /* Print value only (after the '=') */
            const char *value = p + var_name_len + 1;
            printf("%s", value);
            free(buf);
            return 0;
        }

        p += entry_len;
        if (p < end) p++; /* past the null */
    }

    free(buf);
    return 1;  /* Variable not found */
}
