# Groups

A filled group that an edge crosses.

```mermaid
---
config:
  layout: circular
---
flowchart LR
  A --> B --> C --> D --> A
  subgraph G [Group]
    B
    C
  end
  style G fill:#cde
  A --> C
```

A collapsed subgraph.

```mermaid
---
config:
  layout: circular
---
flowchart LR
  A --> B
  subgraph G
    B --> C
  end
  C --> D --> A
  G@{ view: collapsed }
```

A group spanning three quarters of the ring. A box clears, so it is a box.

```mermaid
---
config:
  layout: circular
---
flowchart LR
  I[Idea]
  subgraph Funded
    S[Spec]
    D[Design]
    B[Build]
    T[Test]
    P[Deploy]
    M[Monitor]
  end
  I --> S --> D --> B --> T --> P --> M --> R[Retire] --> I
  style Funded fill:#ffd
```

The wheel with a group. Spokes cross the top of the box, so its title
sits at the bottom.

```mermaid
---
config:
  layout: circular
---
flowchart LR
  A[Plan]
  subgraph Delivery
    C[Test]
    D[Ship]
  end
  A --> B[Build] --> C --> D --> E[Watch] --> F[Learn] --> A
  A --> Hub[Vision]
  B --> Hub
  C --> Hub
  D --> Hub
  E --> Hub
  F --> Hub
```

A group no box can clear, around a hub outside it, drawn as a band.

```mermaid
---
config:
  layout: circular
---
flowchart LR
  subgraph Core
    A[Alpha]
    B[Bravo]
    C[Charlie]
    D[Delta]
  end
  A --> B --> C --> D --> E[Echo] --> F[Foxtrot] --> A
  A --> H[Registry]
  B --> H
  C --> H
  D --> H
  E --> H
  F --> H
```
