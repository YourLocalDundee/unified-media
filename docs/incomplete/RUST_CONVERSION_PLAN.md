# The Rust rewrite

Moved. The Rust implementation of this app is a separate, standalone repo — a clone of it, rewritten
— and its plan lives with it:

    unified-media-rs/docs/PLAN.md

**Nothing in that repo replaces anything here.** This app keeps running as it is. The Rust one is a
clone that stands on its own; it uses this codebase as the reference for what the behaviour should
be, and it has its own database, seeded from a snapshot so it runs against real data without
touching this one.

Earlier drafts of this document planned it as a strangler-fig migration, with a cutover per phase.
That framing is gone. There is no flip to schedule, no shadow-mode comparison to run, and no code
here queued for deletion.
