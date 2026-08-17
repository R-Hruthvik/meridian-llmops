# 0008. Three-Cycle Reformulation Limit with Safe Refusal Fallback

We capped the LangGraph self-healing cyclic loop to a maximum of 3 query reformulation iterations. If the Critic Agent continues to reject generated drafts after 3 cycles due to lack of ground truth in retrieved context, the system safely terminates with a standardized refusal message indicating the requested information is absent from the knowledge base.
