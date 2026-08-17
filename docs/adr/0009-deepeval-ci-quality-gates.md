# 0009. Automated DeepEval CI Quality Thresholds

We established baseline DeepEval threshold assertions in GitHub Actions CI pipelines: Faithfulness >= 0.90 (maximum allowable hallucination rate of 10%), Answer Relevancy >= 0.80, and Context Recall >= 0.75. Pull requests that regress below these thresholds on the Golden Dataset are automatically blocked from merging.
