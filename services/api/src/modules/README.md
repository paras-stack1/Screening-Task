# Feature modules

Each folder is one business domain. Modules are added in later steps; Step 1 only
creates the folders. Every module follows the same layout:

```
<module>/
  <module>.routes.ts      Express Router: URL + middleware (auth, validate) -> controller
  <module>.controller.ts  Reads validated input from res.locals, calls the service, sends the response
  <module>.service.ts     Business rules. The only layer that talks to Prisma / other modules
  <module>.schema.ts      Zod schemas for request body / params / query
```

Very thin handlers (validated input -> one service call -> JSON) may live inline in
`<module>.routes.ts` instead of a separate controller file (see auth/auth.routes.ts).

Rules:
- Controllers stay thin and contain no business logic; services hold no Express code.
- Request/response shapes that the mobile app also uses go in `packages/shared-contracts`.
- Only `src/integrations/ai-service` talks to the Python AI service; `screening` calls it
  through that adapter and must keep working when the AI service is unavailable.
- Register each module router in `src/routes/index.ts`.

| Module      | Responsibility (planned)                                         |
|-------------|------------------------------------------------------------------|
| auth        | Login, JWT, refresh rotation, sessions, password change (done)   |
| users       | ASHA / Anganwadi worker and supervisor accounts, roles          |
| facilities  | Anganwadi centres, schools, health facilities (referral targets)|
| children    | Child registration and profile                                  |
| guardians   | Parent / guardian details linked to children                    |
| consent     | Recording and checking guardian consent before screening        |
| screening   | Screening questionnaires and results (AI support optional)      |
| referrals   | Referral creation and follow-up tracking                        |
