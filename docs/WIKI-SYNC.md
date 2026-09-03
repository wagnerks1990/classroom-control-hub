# GitHub Wiki Synchronization

The `wiki/` directory in the main repository is the version-controlled mirror/source for the GitHub Wiki.

GitHub's normal repository Contents API does not expose Wiki write operations, so Wiki publishing is performed through the Wiki's Git repository.

## Sync from a local clone

From a clone that has permission to push the Wiki:

```bash
cd classroom-control-hub
bash scripts/sync-wiki.sh
```

The script:

1. derives the repository owner/name from `origin`;
2. clones `<repository>.wiki.git` into a temporary directory;
3. replaces the Wiki Markdown files with the contents of `wiki/`;
4. commits only if content changed;
5. pushes the synchronized Wiki.

Your normal GitHub credentials/PAT/credential-manager configuration must allow pushing to the Wiki repository.

## Safety

`wiki/` is treated as authoritative for Markdown pages. The sync helper removes Wiki files that are not present in the mirror before committing. Add any page that should survive synchronization to `wiki/` first.

Do not place secrets, production credentials, private endpoints, student/user data, or internal-only diagnostic content in Wiki pages.

## Documentation contract

When a code or operational change affects documentation:

1. update the relevant `docs/` page;
2. update the matching `wiki/` mirror page;
3. update `AGENTS.md` and/or `docs/AI-CONTEXT.md` if the change affects future contributor/AI reasoning;
4. run `bash scripts/sync-wiki.sh` from an authenticated clone to publish the actual GitHub Wiki.
