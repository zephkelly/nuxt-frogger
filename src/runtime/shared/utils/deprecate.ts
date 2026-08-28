import { froggerInternal } from './internal-log'

/**
 * Announce that a public API is deprecated, at most once per process.
 *
 * Frogger had no deprecation mechanism at all - no convention, no warning
 * helper, no support window - which is why three separate proposals to "keep a
 * thin deprecated adapter for one minor version" were not executable.
 *
 * The warning is ungated on purpose. A deprecation notice that is silent at the
 * production default reaches nobody: the whole point is that the author sees it
 * before the removal lands.
 *
 * Convention for the source side: mark the export `@deprecated` in its JSDoc,
 * naming the replacement and the release it is removed in, and call this from
 * its body.
 */
export function deprecate(what: string, replacement: string, removedIn: string): void {
    froggerInternal.always.onceWarn(
        `deprecated:${what}`,
        `${what} is deprecated and will be removed in ${removedIn}. Use ${replacement} instead.`,
    )
}
