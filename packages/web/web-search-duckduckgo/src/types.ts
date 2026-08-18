/**
 * Wire types of the DuckDuckGo backends (Instant-Answer JSON and the unofficial
 * HTML result page). Only the fields the provider reads are declared.
 * @module @deepseek-ai/dsh-web-search-duckduckgo/types
 */

/** One Instant-Answer related topic or category (deeply nested). */
export interface DdgRelatedTopic {
  readonly name?: string
  readonly FirstURL?: string
  readonly Text?: string
  readonly Topics?: readonly DdgRelatedTopic[]
}

/** The official Instant-Answer JSON envelope (subset). */
export interface DdgInstantResponse {
  readonly Heading?: string
  readonly AbstractText?: string
  readonly AbstractURL?: string
  readonly RelatedTopics?: readonly DdgRelatedTopic[]
}
