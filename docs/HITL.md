# Human review queue status

The SQLAlchemy `ExtractedField` and `ReviewItem` models and the `/v1/review`
routes are experimental, disconnected components. The routes are mounted and
can list or update rows that already exist, but the ingestion pipeline does not
create those rows. Query responses expose verification results, but queries do
not create review items or attach a trace ID to them. A corrected field is
saved in the database; it is not propagated to chunks, the retrieval index, or
query verification.

Do not treat the review queue as an active ingestion or query workflow. The
`confidence_threshold` setting is currently unused and does not define when an
item should be queued. Field extraction confidence and answer verification
status are separate values; no mapping between them is defined.

Before connecting these components to user paths, define:

- The source and meaning of extraction confidence, including its calibration
  and the threshold's scope and boundary behavior.
- Which verified or unverified query outcomes qualify for review, and how
  queue entries link to query traces, claims, and source chunks.
- Queue ownership, tenant isolation, deduplication, and review timing/SLA.
- What approval, rejection, and correction mean for source data and how a
  correction affects chunk storage, indexes, and later answers.
- The audit and retention behavior for review actions and corrected values.

Until those contracts are defined and implemented, keep these models and
routes experimental; their presence does not indicate a live human-review
loop.
