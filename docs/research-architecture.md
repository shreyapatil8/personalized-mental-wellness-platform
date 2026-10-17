# Implemented research architecture

```mermaid
flowchart TD
    UI[React student interface] --> API[Express and role authorization]
    API --> Track[WHO-5, mood and journals]
    API --> Survey[Complete 22-item survey]
    Survey --> Python[Python inference with saved pipeline]
    Train[Kaggle binary study: training-only CV selection] --> Model[Versioned model and evaluation artifacts]
    Model --> Python
    Python --> Estimate[Eustress or Distress with provenance]
    Track --> Mongo[(MongoDB)]
    Estimate --> Mongo
    Mongo --> Engine[Recency, relevance and priority selection]
    Engine --> Budget[Structured context within estimated token budget]
    Budget --> Reply[Local Ollama reply or explicit setup error]
    Reply --> Chat[Student HTTP or Socket.IO chat]
    Mongo --> Consent[Active appointment and both sharing permissions]
    Consent --> Briefing[Selected records and generated draft briefing]
    Briefing --> Recheck[Recheck consent after provider call]
    Recheck --> Counsellor[Assigned counsellor]
    Counsellor --> Notes[Private notes and separately shared progress]
    UI --> Documents[Explicit PDF sharing permission]
    Documents --> PrivateStorage[Authenticated Cloudinary storage]
    PrivateStorage --> SignedURL[Participant authorization and 60-second link]
    API --> Metrics[Route template and timing only]
    Metrics --> Admin[Admin aggregate dashboard]
    Mongo --> Trends[Daily means and seven-day observed-day averages]
    Trends --> UI
```

The classifier uses the separate survey; WHO-5/mood/journals do not become fabricated Kaggle features. The binary study excludes No Stress and cannot predict that class. Model output is not clinical severity. Context estimation measures the rendered context prompt, not total provider billing tokens.

Training and authored context evaluation are offline research workflows. Live AI/storage require configured provider accounts. Admin account-management APIs may expose identity for administration; the analytics overview excludes named wellness records. Private counselling notes and student-shared progress are different fields.

This text diagram reflects the implementation. Incorporate it into the original Word synopsis's architecture figure when completing its visual review.
