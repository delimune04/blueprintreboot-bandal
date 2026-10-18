/** A discovery record has no PDF until its first explicit attachment. */
export function isMetadataOnlyPaper(paper) {
  return paper?.metadata_only === true && paper.missing_pdf === true;
}
