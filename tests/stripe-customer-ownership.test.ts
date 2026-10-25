import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// EXECUTABLE tests for createOrRetrieveCustomer's ownership rules
// (ONE WORKSPACE = ONE STRIPE CUSTOMER). The Stripe SDK is mocked at the
// package level and Prisma is an in-memory Subscription table — no database
// connection, no Stripe call, no real customer.

const mocks = vi.hoisted(() => ({
  customersRetrieve: vi.fn(),
  customersList:     vi.fn(),
  customersCreate:   vi.fn(),
  customersUpdate:   vi.fn(),
  rows:              new Map<string, { workspaceId: string; stripeCustomerId: string; plan: string }>(),
}))

vi.mock('stripe', () => ({
  default: class {
    customers = {
      retrieve: mocks.customersRetrieve,
      list:     mocks.customersList,
      create:   mocks.customersCreate,
      update:   mocks.customersUpdate,
    }
  },
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    subscription: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.workspaceId) return mocks.rows.get(where.workspaceId) ?? null
        for (const row of mocks.rows.values())
          if (row.stripeCustomerId === where.stripeCustomerId) return row
        return null
      }),
      // Mirrors the @unique constraint on Subscription.stripeCustomerId.
      upsert: vi.fn(async ({ where, create, update }: any) => {
        for (const row of mocks.rows.values())
          if (row.stripeCustomerId === (update.stripeCustomerId ?? create.stripeCustomerId) && row.workspaceId !== where.workspaceId)
            throw new Error('Unique constraint failed on stripeCustomerId')
        const current = mocks.rows.get(where.workspaceId)
        const next = current ? { ...current, ...update } : { ...create }
        mocks.rows.set(where.workspaceId, next)
        return next
      }),
    },
  },
}))

import { createOrRetrieveCustomer, CUSTOMER_OWNERSHIP_CONFLICT } from '@/lib/stripe'

const WS_A = 'ws_a'
const WS_B = 'ws_b'
const EMAIL = 'owner@example.com'

function customer(id: string, metadata: Record<string, string> = {}) {
  return { id, deleted: false, email: EMAIL, metadata }
}

function store(workspaceId: string, stripeCustomerId: string) {
  mocks.rows.set(workspaceId, { workspaceId, stripeCustomerId, plan: 'FREE' })
}

function missing() {
  return Object.assign(new Error('No such customer'), { code: 'resource_missing' })
}

function run(workspaceId = WS_A) {
  return createOrRetrieveCustomer({ workspaceId, email: EMAIL, name: 'Owner' })
}

beforeEach(() => {
  mocks.rows.clear()
  mocks.customersList.mockResolvedValue({ data: [], has_more: false })
  mocks.customersCreate.mockImplementation(async (args: any) => customer('cus_new', args.metadata))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('stored customer on this workspace', () => {
  it('stored customer tagged for the same workspace is reused', async () => {
    store(WS_A, 'cus_a')
    mocks.customersRetrieve.mockResolvedValue(customer('cus_a', { workspaceId: WS_A }))
    expect(await run()).toBe('cus_a')
    expect(mocks.customersRetrieve).toHaveBeenCalledWith('cus_a')
    expect(mocks.customersList).not.toHaveBeenCalled()
    expect(mocks.customersCreate).not.toHaveBeenCalled()
    expect(mocks.customersUpdate).not.toHaveBeenCalled()
  })

  it('legacy stored customer with no workspaceId metadata is preserved', async () => {
    store(WS_A, 'cus_legacy')
    mocks.customersRetrieve.mockResolvedValue(customer('cus_legacy'))
    expect(await run()).toBe('cus_legacy')
    expect(mocks.customersCreate).not.toHaveBeenCalled()
    expect(mocks.customersUpdate).not.toHaveBeenCalled()
    expect(mocks.rows.get(WS_A)?.stripeCustomerId).toBe('cus_legacy')
  })

  it('legacy stored customer with unrelated metadata only is preserved', async () => {
    store(WS_A, 'cus_legacy')
    mocks.customersRetrieve.mockResolvedValue(customer('cus_legacy', { source: 'old-signup' }))
    expect(await run()).toBe('cus_legacy')
    expect(mocks.customersCreate).not.toHaveBeenCalled()
  })

  it('stored customer whose metadata names another workspace fails closed', async () => {
    store(WS_A, 'cus_x')
    mocks.customersRetrieve.mockResolvedValue(customer('cus_x', { workspaceId: WS_B }))
    await expect(run()).rejects.toThrow(CUSTOMER_OWNERSHIP_CONFLICT)
    expect(mocks.customersCreate).not.toHaveBeenCalled()
    expect(mocks.customersUpdate).not.toHaveBeenCalled()
    expect(mocks.rows.get(WS_A)?.stripeCustomerId).toBe('cus_x')
  })

  it('deleted stored customer → replacement created for the same workspace', async () => {
    store(WS_A, 'cus_gone')
    mocks.customersRetrieve.mockResolvedValue({ id: 'cus_gone', deleted: true })
    expect(await run()).toBe('cus_new')
    expect(mocks.customersCreate.mock.calls[0][0].metadata).toEqual({ workspaceId: WS_A })
    expect(mocks.rows.get(WS_A)?.stripeCustomerId).toBe('cus_new')
  })

  it('missing stored customer (resource_missing) → replacement created', async () => {
    store(WS_A, 'cus_wrong_mode')
    mocks.customersRetrieve.mockRejectedValue(missing())
    expect(await run()).toBe('cus_new')
    expect(mocks.rows.get(WS_A)?.stripeCustomerId).toBe('cus_new')
  })

  it('deleted stored customer + untagged email match → still a fresh customer', async () => {
    store(WS_A, 'cus_gone')
    mocks.customersRetrieve.mockResolvedValue({ id: 'cus_gone', deleted: true })
    mocks.customersList.mockResolvedValue({ data: [customer('cus_email_only')], has_more: false })
    expect(await run()).toBe('cus_new')
    expect(mocks.customersUpdate).not.toHaveBeenCalled()
  })

  it('other Stripe errors propagate (no silent recreate)', async () => {
    store(WS_A, 'cus_a')
    mocks.customersRetrieve.mockRejectedValue(Object.assign(new Error('rate limited'), { code: 'rate_limit' }))
    await expect(run()).rejects.toThrow('rate limited')
    expect(mocks.customersCreate).not.toHaveBeenCalled()
  })

  it('free_ placeholder is not sent to Stripe and is replaced by a real customer', async () => {
    store(WS_A, `free_${WS_A}`)
    expect(await run()).toBe('cus_new')
    expect(mocks.customersRetrieve).not.toHaveBeenCalled()
    expect(mocks.rows.get(WS_A)?.stripeCustomerId).toBe('cus_new')
  })
})

describe('no stored customer', () => {
  it('creates a new customer tagged with the workspace', async () => {
    expect(await run()).toBe('cus_new')
    expect(mocks.customersCreate).toHaveBeenCalledWith({ email: EMAIL, name: 'Owner', metadata: { workspaceId: WS_A } })
    expect(mocks.rows.get(WS_A)).toEqual({ workspaceId: WS_A, stripeCustomerId: 'cus_new', plan: 'FREE' })
  })

  it('email match tagged for ANOTHER workspace is not reused or relabelled', async () => {
    mocks.customersList.mockResolvedValue({ data: [customer('cus_b', { workspaceId: WS_B })], has_more: false })
    expect(await run()).toBe('cus_new')
    expect(mocks.customersUpdate).not.toHaveBeenCalled()
  })

  it('email match with NO workspaceId metadata is not reused or relabelled', async () => {
    mocks.customersList.mockResolvedValue({ data: [customer('cus_untagged')], has_more: false })
    expect(await run()).toBe('cus_new')
    expect(mocks.customersUpdate).not.toHaveBeenCalled()
  })

  it('several customers sharing the email → none is picked by email alone', async () => {
    mocks.customersList.mockResolvedValue({
      data: [customer('cus_1'), customer('cus_2', { workspaceId: WS_B }), customer('cus_3', { workspaceId: '' })],
      has_more: false,
    })
    expect(await run()).toBe('cus_new')
    expect(mocks.customersUpdate).not.toHaveBeenCalled()
  })

  it('exactly one email match tagged for THIS workspace is recovered (drift repair)', async () => {
    mocks.customersList.mockResolvedValue({
      data: [customer('cus_other', { workspaceId: WS_B }), customer('cus_mine', { workspaceId: WS_A })],
      has_more: false,
    })
    expect(await run()).toBe('cus_mine')
    expect(mocks.customersCreate).not.toHaveBeenCalled()
    expect(mocks.rows.get(WS_A)?.stripeCustomerId).toBe('cus_mine')
  })

  it('deleted candidates are ignored', async () => {
    mocks.customersList.mockResolvedValue({ data: [{ ...customer('cus_mine', { workspaceId: WS_A }), deleted: true }], has_more: false })
    expect(await run()).toBe('cus_new')
  })

  it('two customers both tagged for this workspace → ambiguous, fails closed', async () => {
    mocks.customersList.mockResolvedValue({
      data: [customer('cus_1', { workspaceId: WS_A }), customer('cus_2', { workspaceId: WS_A })],
      has_more: false,
    })
    await expect(run()).rejects.toThrow(CUSTOMER_OWNERSHIP_CONFLICT)
    expect(mocks.customersCreate).not.toHaveBeenCalled()
    expect(mocks.rows.has(WS_A)).toBe(false)
  })

  it('tagged candidate already stored on another workspace fails closed', async () => {
    store(WS_B, 'cus_mine')
    mocks.customersList.mockResolvedValue({ data: [customer('cus_mine', { workspaceId: WS_A })], has_more: false })
    await expect(run()).rejects.toThrow(CUSTOMER_OWNERSHIP_CONFLICT)
    expect(mocks.rows.get(WS_B)?.stripeCustomerId).toBe('cus_mine')
    expect(mocks.rows.has(WS_A)).toBe(false)
  })
})

describe('cross-workspace isolation', () => {
  it("workspace A's customer never becomes stored on workspace B", async () => {
    store(WS_A, 'cus_a')
    mocks.customersRetrieve.mockResolvedValue(customer('cus_a', { workspaceId: WS_A }))
    // Same owner email, both A's customer and an untagged one visible by email.
    mocks.customersList.mockResolvedValue({
      data: [customer('cus_a', { workspaceId: WS_A }), customer('cus_untagged')],
      has_more: false,
    })
    mocks.customersCreate.mockImplementation(async (args: any) => customer('cus_b_new', args.metadata))

    expect(await run(WS_B)).toBe('cus_b_new')
    expect(mocks.customersCreate.mock.calls[0][0].metadata).toEqual({ workspaceId: WS_B })
    expect(mocks.rows.get(WS_A)?.stripeCustomerId).toBe('cus_a')
    expect(mocks.rows.get(WS_B)?.stripeCustomerId).toBe('cus_b_new')
    expect(mocks.customersUpdate).not.toHaveBeenCalled()

    // And A still resolves to its own customer afterwards.
    expect(await run(WS_A)).toBe('cus_a')
  })

  it('error message exposes no customer or workspace IDs', () => {
    expect(CUSTOMER_OWNERSHIP_CONFLICT).not.toMatch(/cus_|ws_/)
  })
})
