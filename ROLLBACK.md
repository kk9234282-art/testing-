# Company research rollback

The stable website immediately before this feature is saved as the annotated Git tag **`before-company-research-2026-11-25`**, pointing to **`2678b8e`**.

## Immediate, for your browser

Open a company and select **Use classic view**. This hides all four new tabs and restores the original line chart and its quote endpoint. Watchlists, comparisons and financial snapshots continue to work. This preference is saved locally in the browser when storage is available. Select **Use chart and research view** to try it again.

## Disable for the whole deployment

Set **`VITE_COMPANY_RESEARCH=false`** in the Vercel project's environment variables, then redeploy. It is a build setting: changing it without rebuilding does not affect an existing deployment. It hides the new tabs and the view switch, and restores the classic detail chart. Remove the setting or set it to `true` and rebuild to enable the feature again.

The disabled build is checked with:

```sh
npm run build
VITE_COMPANY_RESEARCH=false npm run build -- --outDir /tmp/tickr-classic-dist
node scripts/research-rollback-smoke.cjs
```

This test uses a separate temporary disabled build and the normal `dist` build. It checks the disabled deployment, a failed optional chart bundle, the classic-view switch and its remembered preference. The disabled build does not replace `dist`.

## Restore the exact saved website

In Vercel, redeploy the deployment built from **`2678b8e`**. Alternatively, revert the single feature commit titled **`Add reversible company charts and research tabs`** using `git revert`, then push the resulting revert commit to `main`. This preserves Git history; do not force-push or reset `main`.

Find the feature commit with:

```sh
git log --oneline --grep='Add reversible company charts and research tabs'
```

The tag preserves the exact baseline; reverting the feature commit alone is suitable when later unrelated changes should be retained. No database migration, user account or remote user-data change is involved. The feature adds only browser-local view preference and read-only, on-demand provider requests.


## Undo only news markers and multi-source history

The research version immediately before this expansion is tagged **`before-news-markers-2026-11-25`** (`1a51768`). Redeploy that version to retain charts and the original research tabs without the expanded news feature. The expansion is a single commit titled **`Add historical news markers and multi-source local history`**, which can be reverted by itself.

To remove all research changes through Git while keeping later unrelated work, revert the news expansion first, then the original company-research commit; the expansion depends on the original panel. The deployment flag or **Use classic view** still disables the entire optional panel immediately. Reverting code does not erase locally saved news; removing browser/site data clears the archive.

## Undo only news quality filters

The news-marker version before headline grouping and quality/source filters is saved as **`before-news-quality-2026-11-25`** (`c3136ec`). Redeploy that version or revert the single commit titled **`Add important news filtering and similar-story grouping`**. This restores the unfiltered headline view while keeping historical news markers and local history. To remove the full research stack through Git, revert quality filters, then the news expansion, then the original research commit. **Use classic view** or `VITE_COMPANY_RESEARCH=false` continues to hide the entire optional panel.
