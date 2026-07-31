// Side-effect import populating `globalThis.IDBKeyRange` (and friends) with
// fake-indexeddb's implementation. Every test in `tests/storage/indexeddb/`
// imports this once, before anything else: the module under test
// (`src/storage/indexeddb/transaction.ts`) references the bare global
// `IDBKeyRange`, exactly like it references `indexedDB` only as a default
// parameter — neither is read at module load time, but `IDBKeyRange` has no
// injection seam of its own (unlike the `IDBFactory` passed to
// `openBikeTripDatabase`), since it is a stateless, static utility class
// rather than a stateful connection. Node has no native IndexedDB
// implementation (confirmed: `typeof indexedDB === 'undefined'` on Node
// 24), so every real browser ships one but Node needs this polyfill —
// dev-only, never imported from `src/`.
import 'fake-indexeddb/auto'
