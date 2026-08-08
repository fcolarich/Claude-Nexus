/**
 * Shared fixture corpus for secrets.test.ts and reflector.test.ts.
 *
 * All values below are SYNTHETIC and NON-FUNCTIONAL. Every SECRET_SAMPLES entry
 * is format-valid for its SECRET_PATTERNS kind (matches length/charset), but its
 * body is an obviously fake, low-entropy placeholder (documented vendor example
 * keys, "EXAMPLE" repeats) so repo secret scanners and push protection do not
 * fire on this file. The lone exception is `high_entropy`, which needs real
 * entropy to exercise the backstop and therefore carries no vendor prefix that
 * a prefix-keyed scanner would match.
 */
export declare const SECRET_SAMPLES: ReadonlyArray<{
    kind: string;
    value: string;
}>;
export declare const BENIGN_SAMPLES: ReadonlyArray<{
    label: string;
    value: string;
}>;
/**
 * A realistic condensed transcript window: ordinary session prose with every
 * SECRET_SAMPLES value and every BENIGN_SAMPLES value embedded inline, so one
 * fixture exercises both the positive (must redact) and false-positive
 * (must pass through) paths. Built by interpolating the sample arrays rather
 * than hardcoding values a second time, so it cannot drift out of sync with
 * SECRET_SAMPLES/BENIGN_SAMPLES if a sample is edited or added.
 */
export declare const SECRET_WINDOW_TEXT: string;
//# sourceMappingURL=secrets.fixtures.d.ts.map