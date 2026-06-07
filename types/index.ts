export type Plan = 'FREE' | 'SOLO' | 'GROWTH' | 'AGENCY'

export interface PlanConfig {
  name: string
  price: number
  clientLimit: number
  qbrLimit: number
  features: string[]
  priceId?: string
}

export interface Client {
  id: string
  name: string
  industry?: string | null
  contactName?: string | null
  contactEmail?: string | null
  userCount?: number | null
  notes?: string | null
  createdAt: Date
  updatedAt: Date
  qbrs?: QBR[]
}

export interface QBR {
  id: string
  clientId: string
  quarter: string
  year: number
  status: 'DRAFT' | 'GENERATED' | 'EXPORTED'
  tickets?: number | null
  avgResolutionHrs?: number | null
  uptimePct?: number | null
  patchCompliancePct?: number | null
  securityIncidents?: number | null
  usersSupported?: number | null
  ticketCategories?: string | null
  wins?: string | null
  upsellOpportunities?: string | null
  slides?: any
  summary?: string | null
  createdAt: Date
  updatedAt: Date
  client?: Client
}
