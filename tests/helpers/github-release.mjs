export function checkRelease(api, { tag, revision }) {
  const ref = api.readTag(tag);
  if (ref) {
    const target = ref.type === 'tag' ? api.readTagObject(ref.sha)?.object : null;
    if (target?.type !== 'commit' || target.sha !== revision) {
      throw new Error('Release tag must be annotated and target the tested commit; use a new version for different source');
    }
  }
  const release = api.readRelease(tag);
  if (release && !ref) throw new Error('Existing release has no verified tag');
  return { ref, release, published: Boolean(release && !release.draft) };
}

export function publishRelease(api, context, assets) {
  const state = checkRelease(api, context);
  if (state.published) return 'already-published';
  if (!state.ref) api.createTag(context.tag, context.revision);
  if (!state.release) api.createDraft(context.tag);
  api.uploadAssets(context.tag, assets);
  api.publishDraft(context.tag);
  return 'published';
}
