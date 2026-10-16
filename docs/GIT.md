# Git: your app is separate from the template

Setup **always** creates the app in a **different folder** than the `Lab_App_TEMPLATE` clone.

## What we guarantee

1. The template’s `.git` (and its `origin` pointing at LocDoc’s GitHub template) is **not copied**.
2. After create, the app runs `git init` fresh with **no remotes**.
3. You cannot push or open a PR against the template repo from the new app unless you deliberately add that remote (don’t).

Check:

```bash
cd /path/to/your-new-app
git remote -v
# (should print nothing)
```

## Create the GitHub repo from the template

On the template repo, open **Actions → Create app → Run workflow**. The new app is published as its own repository under the same GitHub organization. Its git history starts there and does not include the template remote.

## Publish to YOUR GitHub

```bash
cd /path/to/your-new-app
git add .
git commit -m "Initial commit"
# Create a new empty repo under YOUR GitHub account/org, then:
git remote add origin https://github.com/YOUR_ORG/YOUR_APP.git
git push -u origin main
```

Use **your** repo URL only — never the Lab_App_TEMPLATE URL.

## Template clone

The folder you ran setup from remains a normal clone of the template (with template remotes). That is fine for creating more apps. Optionally delete it after setup if you checked that option.
