<!--
Sync Impact Report
==================
Version change: (none) → 1.0.0
Rationale: Initial ratification. No prior filled version existed — the file was the unfilled
template scaffold — so this is not an amendment and MAJOR.MINOR.PATCH semantics start at 1.0.0.

Modified principles: N/A (first ratification, no renames)

Added sections:
- Core Principles I–V (Local-First Privacy, Narrow Product Surface, Behavior-Driven TDD,
  Security Review as a Gate, Simplicity & Cyclomatic Discipline)
- Technology & Security Constraints
- Development Workflow
- Governance

Removed sections: N/A

Deferred / TODO placeholders: None. RATIFICATION_DATE is set to the date this constitution was
first authored, since no earlier ratified version exists to preserve.

Templates checked for alignment:
- .specify/templates/ (constitution-template resolved via resolve-template.sh) — source template,
  not modified, per scope guard.
- Dependent commands (/speckit-specify, /speckit-plan, /speckit-tasks) read this file at runtime
  and were not modified, per scope guard.
-->

# Evangeline Constitution

## Core Principles

### I. Local-First Privacy (NON-NEGOTIABLE)
Document content MUST NOT leave the user's device unless the user has explicitly chosen a
processing path that requires it, and that path MUST be limited to `localhost`/`127.0.0.1`
endpoints under the user's own control. Concretely:
- Parsing (PDF, EPUB, or any future format) MUST happen in-browser; no document upload to an
  Evangeline-operated backend is permitted.
- No account, sign-in, or server-side document history MAY be introduced.
- Any optional local TTS or processing endpoint MUST be validated as loopback-only before use;
  requests to non-local hosts MUST be rejected before any text is sent.
- Session and resume state (e.g., bookmarks) MUST store the minimum data needed to function
  (a passage index and a content-derived key), never raw filenames, extracted text, or file
  bytes.

Rationale: privacy-by-architecture is the product's reason to exist, not a feature toggle. A
single silent regression here (e.g., a debug log of extracted text, a bookmark that leaks a
filename) breaks the core promise users are relying on and cannot be walked back with a patch
note.

### II. Narrow Product Surface
Evangeline does one job: turn a document into a good listening experience. Every proposed
feature MUST pass the test "does this make a document better to listen to?" before it is
scoped into a plan.
- Features that expand the surface without serving that job (general AI chat, summarization,
  document libraries, social features, broad format support beyond what a plan explicitly
  approves) MUST be rejected or deferred, not absorbed by default.
- When a feature is added that a current product plan lists as out-of-scope, that conflict
  MUST be raised and resolved explicitly (update the plan, or cut the feature) rather than left
  as silent drift.

Rationale: the differentiated value is the document-to-listening pipeline, not breadth. Scope
creep here dilutes the one property (it sounds good, and it's private) that competitors with
commodity TTS cannot easily copy.

### III. Behavior-Driven TDD (NON-NEGOTIABLE)
All new logic MUST be developed test-first, in small cycles: write one failing test describing
observable behavior, write the minimal code to pass it, then refactor without changing the
test's intent.
- Tests MUST describe public behavior, observable outcomes, or security invariants (e.g. "a
  bookmark never restores for a different PDF", "corrupt bookmark data is discarded without
  blocking reading") — never constructors, private methods, internal state, concrete types, or
  call sequences.
- Framework guarantees, language semantics, and third-party library contracts MUST NOT be
  under test.
- UI components, CSS, and design tokens are exempt from this principle; visual work is
  reviewed by direct inspection instead of TDD cycles.

Rationale: this project's own test suite already follows this discipline (see
`pdf-reader/reader.test.js`), and it is what keeps refactors (e.g. swapping the extraction
engine, changing chunking strategy) safe without locking in implementation detail.

### IV. Security Review as a Gate
Every feature plan touching document parsing, network requests, storage, or third-party code
MUST include an explicit security review before implementation, mapped to OWASP Top 10
categories, with a stated mitigation or an explicit N/A reason.
- Third-party runtime code (parsing libraries, TTS engines) MUST be vendored at a pinned
  version rather than fetched from a CDN at runtime, to close supply-chain risk.
- Extracted document content is untrusted input: it MUST be rendered as literal text only,
  never interpreted as HTML/markup or executed.
- Decompression or parsing of user-supplied archives (e.g. EPUB) MUST be bounded (size and
  entry-count caps) so a malformed or adversarial file fails cleanly instead of exhausting
  memory.
- Any local network request path MUST be constrained to loopback addresses and validated
  before every request, not just at configuration time.

Rationale: this codebase already carries a working example of this discipline (see the
Security section of `pdf-reader/README.md`, mapped to OWASP A02, A03, A05, A07, A08, A09). The
constitution makes that practice mandatory going forward rather than incidental.

### V. Simplicity & Cyclomatic Discipline
Code MUST favor the simplest design that satisfies current, real requirements.
- Cyclomatic complexity MUST stay at 10 or less per function/method; reduce branching with
  guard clauses, clearer conditions, and focused functions rather than hiding complexity to
  satisfy the number. Any exception above the limit MUST be documented with the reason directly
  above the function.
- Do not build abstractions, configuration surfaces, or extensibility for hypothetical future
  requirements (YAGNI). Three similar lines of code are preferable to a premature abstraction.
- Public behavior MUST be preserved across refactors; refactors are validated by running the
  relevant behavior tests (Principle III), not by re-deriving them from scratch.

Rationale: this is a small, privacy-focused tool maintained by a small team; unnecessary
abstraction and unbounded branching cost more here than in a large platform, since every added
surface is more that must be reasoned about under Principles I and IV.

## Technology & Security Constraints

- Third-party libraries used at runtime for parsing or rendering (e.g. PDF.js, fflate) MUST be
  vendored locally at a pinned version; no runtime CDN script execution is permitted.
- Any static-file HTML entry point MUST ship a restrictive Content-Security-Policy; production
  hosting SHOULD set equivalent HTTP security headers.
- Cryptographic identifiers derived from user content (e.g. bookmark keys) MUST use a vetted
  hash (e.g. SHA-256) over content bytes, and MUST NOT retain the source content or filename
  alongside the derived key.
- New file formats or input sources MUST define an explicit failure mode for malformed or
  hostile input (corrupt archive, oversized payload, unsupported encoding) before being
  accepted into a feature plan.

## Development Workflow

- Work proceeds in small TDD cycles per Principle III; do not write multiple failing tests
  before making the current one pass.
- Every feature plan or non-trivial change MUST open with a Security Review section (Principle
  IV) before implementation begins.
- Scope decisions MUST be checked against Principle II before a feature is added to a plan;
  when in doubt, defer rather than default to inclusion.
- Refactors MUST NOT change test intent; if a refactor requires changing a test, that is a
  signal the change is altering behavior, not just structure, and MUST be treated as a new
  behavior change subject to Principle III.

## Governance

This constitution supersedes ad hoc practice for all work in this repository. Where project
memory, prior conversation guidance, or a dependent Spec Kit template conflicts with a
principle here, this document controls until amended.

**Amendment procedure**: propose the change with rationale, update this file via the
constitution workflow (not by hand-editing dependent templates), increment the version per the
policy below, and record the change in the Sync Impact Report at the top of this file.

**Versioning policy** (semantic versioning applied to governance):
- MAJOR: backward-incompatible removal or redefinition of a principle.
- MINOR: a new principle or section added, or materially expanded guidance.
- PATCH: wording clarifications, typo fixes, non-semantic refinements.

**Compliance review**: any plan, PR, or implementation that touches document parsing,
storage, or network paths MUST be checked against Principles I and IV before merge. Complexity
that exceeds Principle V's limit MUST carry a documented justification or be refactored before
merge.

**Version**: 1.0.0 | **Ratified**: 2026-09-11 | **Last Amended**: 2026-09-11
