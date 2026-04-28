/*
 * htk-getenv — Linux helper to read an environment variable from another process.
 *
 * Usage: htk-getenv <pid> <var_name>
 * Output: Prints the value (without key= prefix, no trailing newline) to stdout
 *         and exits 0.
 * Exit 1: Variable not found, process not found, or permission denied.
 *
 * Mechanism: Reads /proc/<pid>/environ which contains null-delimited
 * KEY=VALUE pairs. Node's `delete process.env.X` only removes from the V8
 * heap — the kernel's /proc copy reflects the initial environment.
 *
 * Security: /proc/<pid>/environ is readable by the process owner only
 * (permission 0400), enforced by the kernel.
 *
 * NOTE: The return value (written to stdout) is a credential.
 * Do not add debug logging that would echo it to stderr.
 */

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* 64 MB cap on environment size — anything larger is pathological */
#define MAX_ENVIRON_SIZE (64 * 1024 * 1024)

int main(int argc, char *argv[]) {
    if (argc != 3) {
        fprintf(stderr, "Usage: %s <pid> <var_name>\n", argv[0]);
        return 1;
    }

    /* Parse PID with overflow checking (atol has UB on overflow) */
    errno = 0;
    long pid = strtol(argv[1], NULL, 10);
    if (errno != 0 || pid <= 0) {
        return 1;
    }

    const char *var_name = argv[2];
    size_t var_name_len = strlen(var_name);

    /* Reject empty var_name — would match malformed "=VALUE" entries */
    if (var_name_len == 0) {
        return 1;
    }

    /* Build path to /proc/<pid>/environ */
    char path[64];
    int n = snprintf(path, sizeof(path), "/proc/%ld/environ", pid);
    if (n < 0 || (size_t)n >= sizeof(path)) {
        return 1;
    }

    FILE *f = fopen(path, "r");
    if (!f) {
        return 1;  /* Process not found or permission denied */
    }

    /* Read entire environ file into memory.
     * /proc/<pid>/environ is typically small (a few KB). */
    size_t capacity = 8192;
    size_t len = 0;
    char *buf = malloc(capacity);
    if (!buf) {
        fclose(f);
        return 1;
    }

    while (1) {
        size_t nread = fread(buf + len, 1, capacity - len, f);
        len += nread;
        if (nread == 0) {
            /* Distinguish EOF from I/O error */
            if (ferror(f)) {
                free(buf);
                fclose(f);
                return 1;
            }
            break;  /* genuine EOF */
        }
        if (len == capacity) {
            /* Cap allocation to prevent OOM from pathological input */
            if (capacity >= MAX_ENVIRON_SIZE) {
                free(buf);
                fclose(f);
                return 1;
            }
            capacity *= 2;
            if (capacity > MAX_ENVIRON_SIZE) {
                capacity = MAX_ENVIRON_SIZE;
            }
            char *newbuf = realloc(buf, capacity);
            if (!newbuf) {
                free(buf);
                fclose(f);
                return 1;
            }
            buf = newbuf;
        }
    }
    fclose(f);

    /* Iterate null-delimited entries */
    char *p = buf;
    char *end = buf + len;

    while (p < end) {
        size_t entry_len = strnlen(p, (size_t)(end - p));

        /* Check if this entry matches "VAR_NAME=..." */
        if (entry_len > var_name_len &&
            p[var_name_len] == '=' &&
            memcmp(p, var_name, var_name_len) == 0)
        {
            /* Write value with explicit length to avoid heap overread if the
             * last entry lacks a null terminator (defensive). */
            size_t value_len = entry_len - var_name_len - 1;
            fwrite(p + var_name_len + 1, 1, value_len, stdout);
            free(buf);
            return 0;
        }

        p += entry_len;
        if (p < end) p++;  /* past the null delimiter */
    }

    free(buf);
    return 1;  /* Variable not found */
}
