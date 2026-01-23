# AI Agent Quick Reference Guide

This guide provides quick commands for AI agents (like Claude Code) to perform common tasks.

## Creating a Release

**Always use the automated workflow:**

```bash
# For bug fixes and minor improvements (most common)
gh workflow run release.yml -f version_bump=patch

# For new features
gh workflow run release.yml -f version_bump=minor

# For breaking changes (rare)
gh workflow run release.yml -f version_bump=major
```

**Almost there!** The workflow handles:
- ✅ Version bump
- ✅ File sync
- ✅ Git commit & tag
- ✅ GitHub release creation

**Then manually trigger publication:**
```bash
# Wait for release workflow to complete, then:
gh workflow run publish.yml -f tag=vX.Y.Z
gh workflow run publish-npm.yml -f tag=vX.Y.Z
```

Why? GitHub Actions security prevents workflows from auto-triggering other workflows.

## Version Bump Decision Tree

```
Is it a breaking change? (API changes, removed features)
├─ YES → major
└─ NO
   └─ Is it a new feature or enhancement?
      ├─ YES → minor
      └─ NO → patch (bug fixes, docs, deps)
```

## Common Tasks

### Check Current Version
```bash
grep '^version' pyproject.toml
```

### Verify Release Published
```bash
# Check GitHub
gh release view

# Check PyPI
curl -s https://pypi.org/pypi/mcpbr/json | jq -r '.info.version'

# Check npm
npm view @greynewell/mcpbr version
```

### Manual Version Sync (rarely needed)
```bash
# Update pyproject.toml first, then:
python3 scripts/sync_version.py
```

### Fix Version Mismatch
```bash
# If pyproject.toml and package.json are out of sync:
python3 scripts/sync_version.py
git add pyproject.toml package.json .claude-plugin/
git commit -m "chore: sync version to $(grep '^version' pyproject.toml | cut -d'"' -f2)"
git push origin main
```

## Workflow Checklist

When making a release:

- [ ] Ensure PR is merged to main
- [ ] Decide version bump type (patch/minor/major)
- [ ] Run: `gh workflow run release.yml -f version_bump=TYPE`
- [ ] Wait ~2 minutes for completion
- [ ] Verify release: `gh release view`
- [ ] Verify PyPI: Check https://pypi.org/project/mcpbr/
- [ ] Verify npm: Check https://www.npmjs.com/package/@greynewell/mcpbr

## What NOT to Do

❌ Don't manually edit version in package.json (sync script handles it)
❌ Don't create releases manually (use the workflow)
❌ Don't skip version syncing
❌ Don't publish to PyPI/npm manually (workflows handle it)
❌ Don't commit without running pre-commit hooks

## Emergency Procedures

### Delete a Bad Release
```bash
# Delete from GitHub
gh release delete v0.3.25 --yes

# Delete tags
git tag -d v0.3.25
git push origin :refs/tags/v0.3.25

# Note: Can't delete from PyPI/npm - must publish new version
```

### Rollback Version
```bash
# Update to previous version in pyproject.toml
sed -i 's/version = "0.3.25"/version = "0.3.24"/' pyproject.toml

# Sync
python3 scripts/sync_version.py

# Commit
git add pyproject.toml package.json .claude-plugin/
git commit -m "chore: rollback to 0.3.24"
git push origin main
```

## Full Documentation

For detailed information, see [RELEASE.md](./RELEASE.md)

## Examples

### After fixing a bug
```bash
# PR #290 fixed Docker TypeError
gh workflow run release.yml -f version_bump=patch
# Creates v0.3.25
```

### After adding a feature
```bash
# Added new benchmark support
gh workflow run release.yml -f version_bump=minor
# Creates v0.4.0
```

### After breaking change
```bash
# Redesigned CLI interface
gh workflow run release.yml -f version_bump=major
# Creates v1.0.0
```

---

**Remember**: One command releases everything. Don't overthink it! 🚀
