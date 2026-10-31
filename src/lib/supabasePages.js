export async function fetchAllRows(pageQuery, pageSize = 1000) {
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error, status } = await pageQuery(from, from + pageSize - 1)
    if (error) throw Object.assign(error, {status})
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}
