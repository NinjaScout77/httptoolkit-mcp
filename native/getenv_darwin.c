/*
 * htk-getenv — macOS helper to read an environment variable from another process.
 *
 * Usage: htk-getenv <pid> <var_name>
 * Output: Prints the value (without key= prefix, no trailing newline) to stdout
 *         and exits 0.
 * Exit 1: Variable not found, process not found, or permission denied.
 *
 * Mechanism: sysctl(KERN_PROCARGS2) returns the initial process arguments
 * and environment. Node's `delete process.env.X` only removes from the V8
 * heap — the kernel's copy is immutable.
 *
 * Security: Only same-user processes are readable (enforced by the kernel).
 *
 * NOTE: The return value (written to stdout) is a credential.
 * Do not add debug logging that would echo it to stderr.
 */

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/sysctl.h>

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <pid> <var_name>\n", argv[0]);
        return 1;
    }

    /* Parse PID with overflow checking (atoi has UB on overflow) */
    errno = 0;
    long tmp = strtol(argv[1], NULL, 10);
    if (errno != 0 || tmp <= 0 || tmp > INT_MAX) {
        return 1;
    }
    pid_t pid = (pid_t)tmp;

    const char *var_name = argv[2];
    size_t var_name_len = strlen(var_name);

    /* Reject empty var_name — would match malformed "=VALUE" entries */
    if (var_name_len == 0) {
        return 1;
    }

    /* First call: get required buffer size */
    int mib[3] = { CTL_KERN, KERN_PROCARGS2, pid };
    size_t size = 0;
    if (sysctl(mib, 3, NULL, &size, NULL, 0) != 0) {
        return 1;  /* Process not found or permission denied */
    }

    /* Guard against empty buffer (implementation-defined malloc(0)) */
    if (size == 0) {
        return 1;
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

    /* Validate nargs — kernel should always provide non-negative, but be safe */
    if (nargs < 0) {
        free(buf);
        return 1;
    }

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
            /* Write value with explicit length to avoid heap overread if the
             * last entry lacks a null terminator (defensive — kernel data
             * is normally null-terminated, but we don't assume). */
            size_t value_len = entry_len - var_name_len - 1;
            fwrite(p + var_name_len + 1, 1, value_len, stdout);
            free(buf);
            return 0;
        }

        p += entry_len;
        if (p < end) p++; /* past the null */
    }

    free(buf);
    return 1;  /* Variable not found */
}
