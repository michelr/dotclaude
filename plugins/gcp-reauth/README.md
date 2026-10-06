# gcp-reauth

A Claude Code mod that notices when Google Cloud credentials have expired and says which login to run.

## What it does

At session start it checks both logins in the background (`gcloud auth print-access-token` and `gcloud auth application-default print-access-token`) and sets the status line and a toast for any that need reauthentication. Network and other failures are ignored.

Also, when a BigQuery MCP call, or a Bash call running `bq`, `gcloud`, `gsutil` or `dbt`, fails with `invalid_rapt`, `invalid_grant`, `reauth related error` or `Reauthentication required`:

- A toast and a status line name the login to run:
  - BigQuery MCP and dbt use application-default credentials: `! gcloud auth application-default login`
  - `bq`, `gcloud` and `gsutil` use the gcloud login: `! gcloud auth login`
  - If the error text names one of the two commands, that one wins
- The model gets a note to ask you to log in again instead of switching to another way of querying

The status line clears, with a "GCP credentials restored" toast, after the next successful call on that credential or a `gcloud auth ... login` run through Claude.

## Limitations

- A login you run yourself with `!` may not pass through the hook, so the status line stays until the next successful BigQuery call
- Any failing `bq`/`dbt` command whose output contains one of the phrases counts, even if auth wasn't the cause

## Development

```bash
claude plugin validate .
npx -p typescript tsc -p .
claude plugin test .
```
