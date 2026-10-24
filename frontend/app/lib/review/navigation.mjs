/** Read-only index: retain source identity/order; never filter the saved dossier. */
export function findReviewRecords(rows, query = '', status = 'all') {
  const terms = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return rows.map((row, index) => ({ row, number: index + 1 })).filter(({ row }) => {
    if (status !== 'all' && row.status !== status) return false;
    const context = row.context ? Object.values(row.context).filter(value => typeof value === 'string') : [];
    const text = [row.text, row.owner, row.due_date, ...context].join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  });
}
