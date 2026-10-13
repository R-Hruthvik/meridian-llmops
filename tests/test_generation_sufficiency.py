from services.rag_engine.generation.sufficiency import has_sufficient_context


def test_dense_score_at_threshold_is_sufficient():
    assert has_sufficient_context(
        "what is Qdrant",
        [{"scores": {"dense": 0.70, "bm25": 0.0}}],
        min_dense_score=0.70,
    )


def test_raw_bm25_hit_without_substantive_term_coverage_is_insufficient():
    assert not has_sufficient_context(
        "what is the stock price of Apple",
        [{"scores": {"dense": 0.2, "bm25": 3.2}}],
        min_dense_score=0.70,
    )


def test_bm25_identifier_match_is_sufficient():
    assert has_sufficient_context(
        "what does QdrantCloud do",
        [{"text": "QdrantCloud handles storage", "scores": {"dense": 0.2, "bm25": 0.3}}],
        min_dense_score=0.70,
    )


def test_bm25_requires_half_of_substantive_terms():
    assert has_sufficient_context(
        "explain Qdrant vector storage",
        [{"text": "Qdrant vector stores records", "scores": {"dense": 0.2, "bm25": 0.3}}],
        min_dense_score=0.70,
    )


def test_numeric_vector_dimension_evidence_is_not_mistaken_for_missing_dimension():
    assert has_sufficient_context(
        "How many vector dimensions does the collection example configure?",
        [{"text": "vectors_config=VectorParams(size=4, distance=Distance.COSINE)", "scores": {"dense": 0.8}}],
    )


def test_two_ui_credentials_must_be_documented_together():
    assert has_sufficient_context(
        "What two credentials are shown for logging into the LiteLLM UI?",
        [{"text": "The username is `admin` and the password is your `LITELLM_MASTER_KEY` value.", "scores": {"dense": 0.8}}],
    )
    assert not has_sufficient_context(
        "What two credentials are shown for logging into the LiteLLM UI?",
        [
            {"text": "The username is `admin`.", "scores": {"dense": 0.8}},
            {"text": "The password is your `LITELLM_MASTER_KEY` value.", "scores": {"dense": 0.8}},
        ],
    )
    assert has_sufficient_context(
        "What two credentials are shown for logging into the LiteLLM UI?",
        [{"text": "username `admin`; password `LITELLM_MASTER_KEY`", "scores": {"dense": 0.8}}],
    )
    assert not has_sufficient_context(
        "What two credentials are shown for logging into the LiteLLM UI?",
        [{"text": "username and password are configured in the UI.", "scores": {"dense": 0.8}}],
    )


def test_topical_but_unsupported_answerability_slots_are_vetoed():
    cases = [
        (
            "What is the private Qdrant cluster password used in production?",
            "Qdrant cluster setup in production describes password protection.",
        ),
        (
            "How many employees work at the company that wrote the FastAPI guide?",
            "The FastAPI guide introduces employee onboarding and staff policies.",
        ),
        (
            "What is the exact monthly cost of a LiteLLM deployment on AWS?",
            "The LiteLLM deployment guide describes running the service on AWS and managing costs.",
        ),
        (
            "Which GPU model is required to run the Qdrant Docker image?",
            "The Qdrant Docker image runs in a container and has deployment requirements.",
        ),
        (
            "What is the guaranteed uptime SLA for the Azure endpoint shown?",
            "The Azure endpoint configuration describes provider availability and request setup.",
        ),
        (
            "Which customer owns the API key shown in the LiteLLM examples?",
            "The LiteLLM examples configure an API key with environment variables.",
        ),
        (
            "What was the exact number of requests served by the demo last month?",
            "The demo served requests through an API last month.",
        ),
    ]
    assert all(
        not has_sufficient_context(question, [{"text": text, "scores": {"dense": 0.8}}])
        for question, text in cases
    )


def test_unrelated_high_level_request_remains_insufficient():
    assert not has_sufficient_context(
        "What is the secret recipe for medieval alchemical immortality potions?",
        [{"text": "General onboarding steps", "scores": {"dense": 0.2, "bm25": 0}}],
    )


def test_answer_slot_paraphrases_and_concrete_value_formats():
    cases = [
        (
            "What is the monthly bill for the deployment?",
            "The service costs $500 per month.",
        ),
        (
            "What availability guarantee does the Azure endpoint provide?",
            "The service provides a 99.95% SLA.",
        ),
        (
            "How much GPU memory is required?",
            "The workload requires 24 GB of GPU memory.",
        ),
        (
            "How many GPUs are required?",
            "The job needs 2 GPUs.",
        ),
        (
            "What is the staff count at the company?",
            "Staff count: 12.",
        ),
        (
            "How many employees does the company have?",
            "The company employs 1 employee.",
        ),
        (
            "What number of requests did the demo serve?",
            "The demo handled 120 requests.",
        ),
        (
            "What is the uptime guarantee under the SLA?",
            "The availability target is 99.9%.",
        ),
        (
            "Who does the API key belong to?",
            "The API key belongs to Acme, a customer.",
        ),
        (
            "Which customer does the example key belong to?",
            "The API key belongs to Acme, a customer.",
        ),
    ]
    assert all(
        has_sufficient_context(question, [{"text": text, "scores": {"dense": 0.8}}])
        for question, text in cases
    )
    unsupported = [
        ("What is the monthly bill for the deployment?", "The service is deployed monthly."),
        ("What availability guarantee does the Azure endpoint provide?", "The Azure endpoint is available."),
        ("How much GPU memory is required?", "The workload needs GPU memory."),
        ("Who does the API key belong to?", "The API key is used by the example."),
        ("Which customer does the example key belong to?", "The example API key belongs to the application."),
    ]
    assert all(
        not has_sufficient_context(question, [{"text": text, "scores": {"dense": 0.8}}])
        for question, text in unsupported
    )


def test_later_eligible_chunk_can_supply_slot_evidence():
    assert has_sufficient_context(
        "What is the exact monthly cost of a LiteLLM deployment on AWS?",
        [
            {"text": "The LiteLLM deployment runs on AWS.", "scores": {"dense": 0.8}},
            {"text": "The monthly AWS deployment cost is $500.", "scores": {"dense": 0.8}},
        ],
    )
