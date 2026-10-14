#!/usr/bin/env bash
# Vercel's Ignored Build Step for Git pushes (vercel.json ignoreCommand): exit 1 builds, exit 0 skips.
# Only a push to main whose top commit changes public/resume/ builds, so a résumé published by resume-builder's
# workflow goes live on its own; every other deploy is a deliberate `npx vercel deploy --prod`.
if [ "$VERCEL_GIT_COMMIT_REF" != main ]; then
  echo "Skip: $VERCEL_GIT_COMMIT_REF is not main"
  exit 0
fi
git diff --quiet HEAD^ HEAD -- public/resume/
case $? in
  1) echo "Build: the top commit changes public/resume/"; exit 1 ;;
  0) echo "Skip: the top commit does not change public/resume/ (deploy by hand)"; exit 0 ;;
  *) echo "Skip: could not compare HEAD with its parent"; exit 0 ;;
esac
