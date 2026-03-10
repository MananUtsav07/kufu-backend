import { randomUUID } from 'node:crypto'

import bcrypt from 'bcryptjs'

type PlainObject = Record<string, unknown>

type SelectOptions = {
  count?: 'exact'
  head?: boolean
}

type QueryResult<T> = {
  data: T | null
  error: { message: string; details?: string } | null
  count?: number | null
}

type FilterOp = 'eq' | 'in' | 'gte' | 'lte' | 'lt' | 'ilike'

type Filter = {
  op: FilterOp
  column: string
  value: unknown
}

type OrderRule = {
  column: string
  ascending: boolean
}

type SeedUser = {
  id: string
  email: string
  password: string
  role: 'user' | 'admin'
  clientId: string
  chatbotId: string
  planCode: 'free' | 'starter' | 'pro' | 'business'
  isVerified: boolean
  subscriptionMessagesInPeriod: number
  subscriptionMessagesTotal: number
}

type TestSeed = {
  starterUser: SeedUser
  limitedUser: SeedUser
  adminUser: SeedUser
}

function nowIso(): string {
  return new Date().toISOString()
}

function toComparable(value: unknown): string | number {
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    return value
  }
  if (value == null) {
    return ''
  }
  return String(value)
}

function parseColumns(columns: string): string[] | null {
  const normalized = columns.trim()
  if (!normalized || normalized === '*') {
    return null
  }

  const parts = normalized
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  return parts.length > 0 ? parts : null
}

function projectRow(row: PlainObject, columns: string[] | null): PlainObject {
  if (!columns) {
    return { ...row }
  }

  const projected: PlainObject = {}
  for (const column of columns) {
    projected[column] = row[column]
  }
  return projected
}

function normalizeRow(table: string, inputRow: PlainObject): PlainObject {
  const row: PlainObject = { ...inputRow }

  if (!row.id) {
    row.id = randomUUID()
  }

  if (!row.created_at) {
    row.created_at = nowIso()
  }

  if (
    table === 'subscriptions' ||
    table === 'chatbots' ||
    table === 'tickets' ||
    table === 'custom_quotes' ||
    table === 'whatsapp_integrations'
  ) {
    if (!row.updated_at) {
      row.updated_at = nowIso()
    }
  }

  if (table === 'users') {
    if (row.is_verified == null) row.is_verified = false
    if (!row.role) row.role = 'user'
  }

  if (table === 'clients') {
    if (!row.plan) row.plan = 'free'
    if (row.knowledge_base_text == null) row.knowledge_base_text = ''
  }

  if (table === 'subscriptions') {
    if (!row.status) row.status = 'active'
    if (row.message_count_in_period == null) row.message_count_in_period = 0
    if (row.total_message_count == null) row.total_message_count = 0
  }

  if (table === 'chatbots') {
    if (!Array.isArray(row.allowed_domains)) row.allowed_domains = []
    if (row.is_active == null) row.is_active = true
    if (row.logo_path == null) row.logo_path = null
    if (row.logo_updated_at == null) row.logo_updated_at = null
    if (row.branding == null) row.branding = {}
  }

  if (table === 'email_verification_tokens') {
    if (!row.expires_at) {
      row.expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }
  }

  if (table === 'tickets') {
    if (!row.status) row.status = 'open'
    if (!row.admin_response) row.admin_response = null
  }

  if (table === 'audit_logs') {
    if (!row.metadata) row.metadata = {}
  }

  return row
}

class InMemorySupabaseClient {
  private readonly tables: Map<string, PlainObject[]>

  constructor(initialRows: Record<string, PlainObject[]>) {
    this.tables = new Map<string, PlainObject[]>()
    for (const [table, rows] of Object.entries(initialRows)) {
      this.tables.set(
        table,
        rows.map((row) => normalizeRow(table, row)),
      )
    }
  }

  public from(table: string): InMemoryQueryBuilder {
    if (!this.tables.has(table)) {
      this.tables.set(table, [])
    }
    return new InMemoryQueryBuilder(this, table)
  }

  public getTable(table: string): PlainObject[] {
    if (!this.tables.has(table)) {
      this.tables.set(table, [])
    }

    return this.tables.get(table) as PlainObject[]
  }

  public storage = {
    listBuckets: async () => ({
      data: [{ name: 'kufu-logos' }, { name: 'kufu-kb-docs' }],
      error: null,
    }),
  }

  public async rpc(_functionName: string, _parameters?: Record<string, unknown>) {
    return {
      data: [],
      error: null,
    }
  }
}

class InMemoryQueryBuilder implements PromiseLike<QueryResult<unknown>> {
  private readonly client: InMemorySupabaseClient

  private readonly table: string

  private operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'

  private selectColumns: string[] | null = null

  private selectOptions: SelectOptions = {}

  private mutationRows: PlainObject[] = []

  private updateValues: PlainObject = {}

  private filters: Filter[] = []

  private orderRule: OrderRule | null = null

  private limitValue: number | null = null

  private rangeValue: { from: number; to: number } | null = null

  private returnRowsForMutation = false

  constructor(client: InMemorySupabaseClient, table: string) {
    this.client = client
    this.table = table
  }

  public select(columns = '*', options: SelectOptions = {}): InMemoryQueryBuilder {
    if (this.operation === 'insert' || this.operation === 'update' || this.operation === 'delete' || this.operation === 'upsert') {
      this.returnRowsForMutation = true
      this.selectColumns = parseColumns(columns)
      return this
    }

    this.operation = 'select'
    this.selectColumns = parseColumns(columns)
    this.selectOptions = options
    return this
  }

  public insert(rows: PlainObject | PlainObject[]): InMemoryQueryBuilder {
    this.operation = 'insert'
    this.mutationRows = Array.isArray(rows) ? rows : [rows]
    return this
  }

  public update(values: PlainObject): InMemoryQueryBuilder {
    this.operation = 'update'
    this.updateValues = values
    return this
  }

  public delete(): InMemoryQueryBuilder {
    this.operation = 'delete'
    return this
  }

  public upsert(rows: PlainObject | PlainObject[]): InMemoryQueryBuilder {
    this.operation = 'upsert'
    this.mutationRows = Array.isArray(rows) ? rows : [rows]
    return this
  }

  public eq(column: string, value: unknown): InMemoryQueryBuilder {
    this.filters.push({ op: 'eq', column, value })
    return this
  }

  public in(column: string, values: unknown[]): InMemoryQueryBuilder {
    this.filters.push({ op: 'in', column, value: values })
    return this
  }

  public gte(column: string, value: unknown): InMemoryQueryBuilder {
    this.filters.push({ op: 'gte', column, value })
    return this
  }

  public lte(column: string, value: unknown): InMemoryQueryBuilder {
    this.filters.push({ op: 'lte', column, value })
    return this
  }

  public lt(column: string, value: unknown): InMemoryQueryBuilder {
    this.filters.push({ op: 'lt', column, value })
    return this
  }

  public ilike(column: string, value: string): InMemoryQueryBuilder {
    this.filters.push({ op: 'ilike', column, value })
    return this
  }

  public order(column: string, options?: { ascending?: boolean }): InMemoryQueryBuilder {
    this.orderRule = { column, ascending: options?.ascending ?? true }
    return this
  }

  public limit(value: number): InMemoryQueryBuilder {
    this.limitValue = value
    return this
  }

  public range(from: number, to: number): InMemoryQueryBuilder {
    this.rangeValue = { from, to }
    return this
  }

  public returns<T>(): InMemoryQueryBuilder {
    void ({} as T)
    return this
  }

  public async single<T>(): Promise<QueryResult<T>> {
    const result = await this.executeMany()
    if (result.error) {
      return result as QueryResult<T>
    }

    const rows = Array.isArray(result.data) ? result.data : []
    if (rows.length !== 1) {
      return {
        data: null,
        error: { message: `Expected exactly one row, received ${rows.length}` },
        count: result.count,
      }
    }

    return {
      data: rows[0] as T,
      error: null,
      count: result.count,
    }
  }

  public async maybeSingle<T>(): Promise<QueryResult<T>> {
    const result = await this.executeMany()
    if (result.error) {
      return result as QueryResult<T>
    }

    const rows = Array.isArray(result.data) ? result.data : []
    if (rows.length === 0) {
      return {
        data: null,
        error: null,
        count: result.count,
      }
    }

    if (rows.length > 1) {
      return {
        data: null,
        error: { message: `Expected zero or one row, received ${rows.length}` },
        count: result.count,
      }
    }

    return {
      data: rows[0] as T,
      error: null,
      count: result.count,
    }
  }

  public then<TResult1 = QueryResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.executeMany().then(onfulfilled ?? undefined, onrejected ?? undefined)
  }

  private applyFilters(rows: PlainObject[]): PlainObject[] {
    return rows.filter((row) => {
      return this.filters.every((filter) => {
        const rawValue = row[filter.column]

        if (filter.op === 'eq') {
          return rawValue === filter.value
        }

        if (filter.op === 'in') {
          return Array.isArray(filter.value) && filter.value.includes(rawValue)
        }

        if (filter.op === 'ilike') {
          const haystack = String(rawValue ?? '').toLowerCase()
          const needle = String(filter.value).replaceAll('%', '').toLowerCase()
          return haystack.includes(needle)
        }

        const left = toComparable(rawValue)
        const right = toComparable(filter.value)

        if (filter.op === 'gte') {
          return left >= right
        }

        if (filter.op === 'lte') {
          return left <= right
        }

        if (filter.op === 'lt') {
          return left < right
        }

        return true
      })
    })
  }

  private applyOrderAndSlice(rows: PlainObject[]): PlainObject[] {
    let sortedRows = [...rows]

    if (this.orderRule) {
      const { column, ascending } = this.orderRule
      sortedRows.sort((leftRow, rightRow) => {
        const left = toComparable(leftRow[column])
        const right = toComparable(rightRow[column])

        if (left === right) {
          return 0
        }

        const comparison = left < right ? -1 : 1
        return ascending ? comparison : -comparison
      })
    }

    if (this.rangeValue) {
      sortedRows = sortedRows.slice(this.rangeValue.from, this.rangeValue.to + 1)
    } else if (this.limitValue != null) {
      sortedRows = sortedRows.slice(0, this.limitValue)
    }

    return sortedRows
  }

  private async executeMany(): Promise<QueryResult<unknown>> {
    if (this.operation === 'select') {
      const allRows = this.client.getTable(this.table)
      const filteredRows = this.applyFilters(allRows)
      const count = this.selectOptions.count === 'exact' ? filteredRows.length : null
      const paginatedRows = this.applyOrderAndSlice(filteredRows)

      if (this.selectOptions.head) {
        return {
          data: null,
          error: null,
          count,
        }
      }

      return {
        data: paginatedRows.map((row) => projectRow(row, this.selectColumns)),
        error: null,
        count,
      }
    }

    if (this.operation === 'insert' || this.operation === 'upsert') {
      const tableRows = this.client.getTable(this.table)
      const insertedRows: PlainObject[] = []

      for (const row of this.mutationRows) {
        const normalized = normalizeRow(this.table, row)
        tableRows.push(normalized)
        insertedRows.push(normalized)
      }

      return {
        data: this.returnRowsForMutation
          ? insertedRows.map((row) => projectRow(row, this.selectColumns))
          : null,
        error: null,
      }
    }

    if (this.operation === 'update') {
      const tableRows = this.client.getTable(this.table)
      const matchingRows = this.applyFilters(tableRows)
      const now = nowIso()

      for (const row of matchingRows) {
        Object.assign(row, this.updateValues)
        if ('updated_at' in row || this.table === 'subscriptions' || this.table === 'clients') {
          row.updated_at = now
        }
      }

      return {
        data: this.returnRowsForMutation
          ? matchingRows.map((row) => projectRow(row, this.selectColumns))
          : null,
        error: null,
      }
    }

    if (this.operation === 'delete') {
      const tableRows = this.client.getTable(this.table)
      const matchingRows = this.applyFilters(tableRows)
      const matchingIds = new Set(matchingRows.map((row) => row.id))

      const remainingRows = tableRows.filter((row) => !matchingIds.has(row.id))
      ;(this.client as unknown as { tables: Map<string, PlainObject[]> }).tables.set(this.table, remainingRows)

      return {
        data: this.returnRowsForMutation
          ? matchingRows.map((row) => projectRow(row, this.selectColumns))
          : null,
        error: null,
      }
    }

    return {
      data: null,
      error: { message: `Unsupported operation for table ${this.table}` },
    }
  }
}

function buildSeedUser(args: {
  email: string
  password: string
  role: 'user' | 'admin'
  planCode: 'free' | 'starter' | 'pro' | 'business'
  isVerified?: boolean
  messageCountInPeriod?: number
  totalMessageCount?: number
}): SeedUser {
  const userId = randomUUID()
  const clientId = randomUUID()
  const chatbotId = randomUUID()

  return {
    id: userId,
    email: args.email,
    password: args.password,
    role: args.role,
    clientId,
    chatbotId,
    planCode: args.planCode,
    isVerified: args.isVerified ?? true,
    subscriptionMessagesInPeriod: args.messageCountInPeriod ?? 0,
    subscriptionMessagesTotal: args.totalMessageCount ?? 0,
  }
}

export function createSeededSupabaseClient(): {
  supabase: InMemorySupabaseClient
  seed: TestSeed
} {
  const starterUser = buildSeedUser({
    email: 'starter@example.com',
    password: 'Starter@12345',
    role: 'user',
    planCode: 'starter',
    messageCountInPeriod: 15,
    totalMessageCount: 130,
  })

  const limitedUser = buildSeedUser({
    email: 'limited@example.com',
    password: 'Limited@12345',
    role: 'user',
    planCode: 'free',
    messageCountInPeriod: 10,
    totalMessageCount: 10,
  })

  const adminUser = buildSeedUser({
    email: 'admin@example.com',
    password: 'Admin@12345',
    role: 'admin',
    planCode: 'business',
    messageCountInPeriod: 0,
    totalMessageCount: 250,
  })

  const seed: TestSeed = {
    starterUser,
    limitedUser,
    adminUser,
  }

  const now = nowIso()
  const inThirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()

  const users = [starterUser, limitedUser, adminUser].map((seedUser) => ({
    id: seedUser.id,
    email: seedUser.email,
    password_hash: bcrypt.hashSync(seedUser.password, 12),
    role: seedUser.role,
    is_verified: seedUser.isVerified,
    created_at: now,
  }))

  const clients = [starterUser, limitedUser, adminUser].map((seedUser) => ({
    id: seedUser.clientId,
    user_id: seedUser.id,
    business_name: `${seedUser.email.split('@')[0]} business`,
    website_url: 'https://example.com',
    plan: seedUser.planCode,
    knowledge_base_text: 'Business context for tests.',
    created_at: now,
  }))

  const subscriptions = [starterUser, limitedUser, adminUser].map((seedUser) => ({
    id: randomUUID(),
    user_id: seedUser.id,
    plan_code: seedUser.planCode,
    status: 'active',
    current_period_start: now,
    current_period_end: inThirtyDays,
    message_count_in_period: seedUser.subscriptionMessagesInPeriod,
    total_message_count: seedUser.subscriptionMessagesTotal,
    created_at: now,
    updated_at: now,
  }))

  const chatbots = [starterUser, limitedUser, adminUser].map((seedUser) => ({
    id: seedUser.chatbotId,
    user_id: seedUser.id,
    client_id: seedUser.clientId,
    name: `${seedUser.email.split('@')[0]} bot`,
    website_url: 'https://example.com',
    allowed_domains: ['example.com'],
    widget_public_key: `widget-key-${seedUser.id.slice(0, 8)}`,
    logo_path: null,
    logo_updated_at: null,
    is_active: true,
    branding: {},
    created_at: now,
    updated_at: now,
  }))

  const plans = [
    { code: 'free', name: 'Free', monthly_message_cap: 10, chatbot_limit: 1, price_inr: 0 },
    { code: 'starter', name: 'Starter', monthly_message_cap: 1000, chatbot_limit: 1, price_inr: 1999 },
    { code: 'pro', name: 'Pro', monthly_message_cap: 10000, chatbot_limit: 1, price_inr: 3999 },
    { code: 'business', name: 'Business', monthly_message_cap: null, chatbot_limit: 10, price_inr: 7999 },
  ].map((plan) => ({
    id: randomUUID(),
    code: plan.code,
    name: plan.name,
    monthly_message_cap: plan.monthly_message_cap,
    chatbot_limit: plan.chatbot_limit,
    price_inr: plan.price_inr,
    is_active: true,
    created_at: now,
  }))

  const tickets = [
    {
      id: randomUUID(),
      user_id: starterUser.id,
      subject: 'Setup question',
      message: 'Need help with installation',
      admin_response: null,
      status: 'open',
      created_at: now,
      updated_at: now,
    },
  ]

  const chatbotMessages = [
    {
      id: randomUUID(),
      user_id: starterUser.id,
      chatbot_id: starterUser.chatbotId,
      session_id: 'seed-session',
      role: 'user',
      content: 'Hello bot',
      tokens_estimate: 3,
      created_at: now,
    },
  ]

  const supabase = new InMemorySupabaseClient({
    users,
    clients,
    subscriptions,
    chatbots,
    plans,
    tickets,
    chatbot_messages: chatbotMessages,
    email_verification_tokens: [],
    audit_logs: [],
    leads: [],
    client_knowledge: [],
    custom_quotes: [],
    kb_files: [],
    chat_messages: [],
    chatbot_settings: [],
    whatsapp_integrations: [],
    whatsapp_onboarding_logs: [],
    rag_pages: [],
    rag_chunks: [],
    rag_ingestion_runs: [],
    website_integrations: [],
  })

  return {
    supabase,
    seed,
  }
}

export type { TestSeed }
