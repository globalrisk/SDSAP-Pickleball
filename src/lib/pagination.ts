interface PageResult<Row> {
  data: Row[] | null
  error: { message: string } | null
}

/** Callers must order by a stable, unique key before applying the range. */
export async function fetchAllPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<Row>>,
): Promise<{ data: Row[]; error: null }> {
  const data: Row[] = []
  const pageSize = 500
  for (;;) {
    const page = await fetchPage(data.length, data.length + pageSize - 1)
    if (page.error) throw page.error
    const rows = page.data ?? []
    if (rows.length === 0) return { data, error: null }
    data.push(...rows)
    // Probe again even after a short page: the API's row cap may be below pageSize.
  }
}
