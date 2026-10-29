/** Read-only search across project metadata. Keep identities and source order. */
export function filterProjectCollection(projects, query = '', status = '', priority = '') {
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase();
  const terms = normalize(query).trim().split(/\s+/u).filter(Boolean);
  return projects.filter(project => {
    if (status && project.status !== status) return false;
    if (priority && project.priority !== priority) return false;
    const text = normalize([project.name, project.description, ...project.tags].join(' '));
    return terms.every(term => text.includes(term));
  });
}
