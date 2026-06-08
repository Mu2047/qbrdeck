import { Document, Page, Text, View, StyleSheet, pdf, Image, Font } from '@react-pdf/renderer'
Font.registerHyphenationCallback(word => [word])
import React from 'react'
import type { QBRSlide, QBRInput } from '@/lib/anthropic'
import { computeHealthScore } from '@/lib/health-score'

const NAVY = '#0a1634'
const GOLD = '#c9a02a'

const styles = StyleSheet.create({
  page: { fontFamily: 'Helvetica', backgroundColor: '#FFFFFF', paddingBottom: 48 },
  cover: { backgroundColor: NAVY, height: '100%', padding: 60, justifyContent: 'center' },
  coverLabel: { color: GOLD, fontSize: 9, letterSpacing: 3, marginBottom: 20 },
  coverTitle: { color: '#FFFFFF', fontSize: 38, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  coverQuarter: { color: GOLD, fontSize: 18, marginBottom: 16 },
  coverGoldBar: { height: 3, backgroundColor: GOLD, marginBottom: 20, width: 80 },
  coverPrepared: { color: '#9CA3AF', fontSize: 11, marginBottom: 4 },
  coverConfidential: { color: '#6B7280', fontSize: 9, letterSpacing: 1 },
  header: { backgroundColor: NAVY, paddingHorizontal: 40, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  headerTitle: { color: '#FFFFFF', fontSize: 13, fontFamily: 'Helvetica-Bold', letterSpacing: 0.5 },
  headerMSP: { color: GOLD, fontSize: 8 },
  goldBar: { height: 2, backgroundColor: GOLD },
  body: { paddingHorizontal: 40, paddingTop: 20 },
  intro: { fontSize: 11, color: '#374151', lineHeight: 1.7, marginBottom: 16 },
  bullet: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-start' },
  bulletBar: { width: 3, height: 28, backgroundColor: GOLD, marginRight: 10, marginTop: 2 },
  bulletText: { fontSize: 11, color: '#111827', lineHeight: 1.6, flex: 1 },
  impactCard: { backgroundColor: '#F0F9FF', borderRadius: 4, padding: 10, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#0369A1' },
  impactText: { fontSize: 10, color: '#0C4A6E', lineHeight: 1.5 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metricCard: { width: '31%', padding: 10, borderRadius: 4, marginBottom: 8 },
  metricLabel: { fontSize: 8, color: '#6B7280', marginBottom: 3 },
  metricValue: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 3 },
  metricStatus: { fontSize: 8, marginBottom: 3 },
  metricInterp: { fontSize: 7.5, color: '#6B7280', lineHeight: 1.4 },
  roadmapGrid: { flexDirection: 'row', gap: 10 },
  roadmapCol: { flex: 1, borderRadius: 4, padding: 10 },
  roadmapLabel: { fontSize: 9, fontFamily: 'Helvetica-Bold', letterSpacing: 1, marginBottom: 6 },
  roadmapItem: { fontSize: 9.5, color: '#111827', lineHeight: 1.5, marginBottom: 6 },
  recCard: { borderRadius: 4, padding: 12, marginBottom: 10, borderLeftWidth: 3 },
  recTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 4 },
  recDetail: { fontSize: 9.5, color: '#374151', lineHeight: 1.5 },
  healthBox: { backgroundColor: '#0d1f3c', borderRadius: 6, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 16 },
  healthScore: { fontSize: 36, fontFamily: 'Helvetica-Bold', color: '#FFFFFF' },
  healthLabel: { fontSize: 9, color: GOLD, letterSpacing: 1 },
  healthStatus: { fontSize: 13, fontFamily: 'Helvetica-Bold', color: '#FFFFFF', marginTop: 2 },
  healthSummary: { fontSize: 9.5, color: '#9CA3AF', marginTop: 4, lineHeight: 1.5, flex: 1 },
  footer: { position: 'absolute', bottom: 16, left: 40, right: 40, flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: '#E5E7EB', paddingTop: 6 },
  footerText: { fontSize: 8, color: '#9CA3AF' },
  sectionDivider: { height: 1, backgroundColor: '#F3F4F6', marginVertical: 12 },
  closingPage: { backgroundColor: NAVY, height: '100%', padding: 60, justifyContent: 'center' },
  closingTitle: { color: '#FFFFFF', fontSize: 28, fontFamily: 'Helvetica-Bold', marginBottom: 12 },
  closingSubtitle: { color: GOLD, fontSize: 16, marginBottom: 24 },
  closingGoldBar: { height: 3, backgroundColor: GOLD, width: 80, marginBottom: 20 },
  closingBody: { color: '#9CA3AF', fontSize: 12, lineHeight: 1.6 },
})

function statusColors(status: string) {
  if (status === 'good')    return { bg: '#F0FDF4', border: '#16A34A', text: '#16A34A', label: 'On track' }
  if (status === 'caution') return { bg: '#FFFBEB', border: '#D97706', text: '#D97706', label: 'Monitor' }
  return { bg: '#FEF2F2', border: '#DC2626', text: '#DC2626', label: 'Needs attention' }
}

function sanitize(text: string): string {
  return text
    .replace(/\u00AD/g, '')        // soft hyphen
    .replace(/\u200B/g, '')        // zero-width space
    .replace(/\u200C/g, '')        // zero-width non-joiner
    .replace(/\u200D/g, '')        // zero-width joiner
    .replace(/\uFEFF/g, '')        // BOM
    .replace(/\u2019|\u2018/g, "'")
    .replace(/\u201C|\u201D/g, '"')
    .replace(/\u2014/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2022/g, '*')
    .replace(/\u00B7/g, '*')
    .replace(/[\u2000-\u206F]/g, '')
    .replace(/[\uFFFD]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
}

function Header({ title, mspName, logoUrl, isWhiteLabel }: { title: string; mspName: string; logoUrl?: string; isWhiteLabel?: boolean }) {
  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{sanitize(title.toUpperCase())}</Text>
        {logoUrl ? (
          <Image src={logoUrl} style={{ width: 70, height: 24, objectFit: 'contain' }} />
        ) : isWhiteLabel ? (
          <Text style={styles.headerMSP}>{sanitize(mspName)}</Text>
        ) : null}
      </View>
      <View style={styles.goldBar} />
    </View>
  )
}

function Footer({ mspName, clientName, quarter, year, pageNum, isWhiteLabel }: { mspName: string; clientName: string; quarter: string; year: number; pageNum: number; isWhiteLabel?: boolean }) {
  return (
    <View style={styles.footer} fixed>
      <Text style={styles.footerText}>
        {isWhiteLabel
          ? `${sanitize(mspName)} | ${sanitize(clientName)} | Q${quarter} ${year} | Confidential`
          : `${sanitize(clientName)} | Q${quarter} ${year} | Confidential | Powered by QBR Deck`}
      </Text>
      <Text style={styles.footerText}>Page {pageNum}</Text>
    </View>
  )
}

function CoverPage({ clientName, quarter, year, mspName, logoUrl, health, isWhiteLabel }: {
  clientName: string; quarter: string; year: number; mspName: string; logoUrl?: string
  health: { score: number; status: string; summary?: string }; isWhiteLabel?: boolean
}) {
  const scoreColor = health.score >= 90 ? '#16A34A' : health.score >= 70 ? '#D97706' : '#DC2626'
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.cover}>
        {logoUrl && <Image src={logoUrl} style={{ width: 120, height: 44, objectFit: 'contain', marginBottom: 24 }} />}
        <Text style={styles.coverLabel}>QUARTERLY BUSINESS REVIEW</Text>
        <Text style={styles.coverTitle}>{sanitize(clientName)}</Text>
        <Text style={styles.coverQuarter}>Q{quarter} {year}</Text>
        <View style={styles.coverGoldBar} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <View style={{ backgroundColor: '#0d1f3c', borderRadius: 6, padding: 10, borderWidth: 1, borderColor: GOLD }}>
            <Text style={{ color: GOLD, fontSize: 7, letterSpacing: 1 }}>TECH HEALTH SCORE</Text>
            <Text style={{ color: '#FFFFFF', fontSize: 28, fontFamily: 'Helvetica-Bold' }}>{health.score}<Text style={{ fontSize: 14, color: '#9CA3AF' }}>/100</Text></Text>
            <Text style={{ color: scoreColor, fontSize: 9, fontFamily: 'Helvetica-Bold' }}>{sanitize(health.status)}</Text>
          </View>
          <Text style={{ color: '#9CA3AF', fontSize: 10, flex: 1, lineHeight: 1.5 }}>{sanitize(health.summary ?? '')}</Text>
        </View>
        <Text style={styles.coverPrepared}>{isWhiteLabel ? `Prepared by ${sanitize(mspName)}` : 'Prepared with QBR Deck'}</Text>
        <Text style={styles.coverConfidential}>CONFIDENTIAL | FOR {sanitize(clientName.toUpperCase())} USE ONLY</Text>
      </View>
    </Page>
  )
}

function ContentPage({ slide, mspName, clientName, quarter, year, pageNum, logoUrl, isWhiteLabel }: {
  slide: QBRSlide; mspName: string; clientName: string; quarter: string; year: number; pageNum: number; logoUrl?: string; isWhiteLabel?: boolean
}) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <Header title={slide.title} mspName={mspName} logoUrl={logoUrl} isWhiteLabel={isWhiteLabel} />
      <View style={styles.body}>
        <Text style={styles.intro}>{sanitize(slide.content)}</Text>

        {slide.type === 'business_impact' && slide.bullets && (
          <View>
            {slide.bullets.map((b, i) => (
              <View key={i} style={styles.impactCard}>
                <Text style={styles.impactText}>{sanitize(b)}</Text>
              </View>
            ))}
          </View>
        )}

        {slide.type === 'metrics' && slide.metrics && (
          <View style={styles.metricsGrid}>
            {slide.metrics.map((m, i) => {
              const c = statusColors(m.status)
              const isHealthScore = m.label?.toLowerCase().includes('health')
              const scoreVal = isHealthScore ? parseInt(m.value) : NaN
              const healthLabel = isHealthScore
                ? (scoreVal >= 90 ? 'Excellent' : scoreVal >= 80 ? 'Strong' : scoreVal >= 70 ? 'Stable with Improvement Needed' : scoreVal >= 60 ? 'Needs Attention' : 'High Risk')
                : c.label
              return (
                <View key={i} style={[styles.metricCard, { backgroundColor: c.bg, borderWidth: 1, borderColor: c.border }]}>
                  <Text style={styles.metricLabel}>{sanitize(m.label)}</Text>
                  <Text style={styles.metricValue}>{sanitize(m.value)}</Text>
                  <Text style={[styles.metricStatus, { color: c.text }]}>{healthLabel}</Text>
                  {m.interpretation && <Text style={styles.metricInterp}>{sanitize(m.interpretation)}</Text>}
                </View>
              )
            })}
          </View>
        )}

        {(slide.type === 'executive_summary' || slide.type === 'wins' || slide.type === 'risks') && slide.bullets && (
          <View>
            {slide.bullets.map((b, i) => (
              <View key={i} style={styles.bullet}>
                <View style={styles.bulletBar} />
                <Text style={styles.bulletText}>{sanitize(b)}</Text>
              </View>
            ))}
          </View>
        )}

        {slide.type === 'roadmap' && slide.priorities && (
          <View style={styles.roadmapGrid}>
            {[
              { key: 'critical' as const,  label: 'CRITICAL',  bg: '#FEF2F2', color: '#DC2626' },
              { key: 'important' as const, label: 'IMPORTANT', bg: '#FFFBEB', color: '#D97706' },
              { key: 'strategic' as const, label: 'STRATEGIC', bg: '#EFF6FF', color: '#2563EB' },
            ].map(col => (
              <View key={col.key} style={[styles.roadmapCol, { backgroundColor: col.bg, borderTopWidth: 3, borderTopColor: col.color }]}>
                <Text style={[styles.roadmapLabel, { color: col.color }]}>{col.label}</Text>
                {(slide.priorities?.[col.key] ?? []).map((item, i) => (
                  <Text key={i} style={styles.roadmapItem}>- {sanitize(item)}</Text>
                ))}
              </View>
            ))}
          </View>
        )}

        {slide.type === 'recommendations' && slide.recommendations && (
          <View>
            {slide.recommendations.map((rec, i) => (
              <View key={i} style={[styles.recCard, {
                backgroundColor: i === 0 ? '#FEF2F2' : i === 1 ? '#FFFBEB' : '#EFF6FF',
                borderLeftColor: i === 0 ? '#DC2626' : i === 1 ? '#D97706' : '#2563EB',
              }]}>
                <Text style={styles.recTitle}>{i + 1}. {sanitize(rec.title)}</Text>
                <Text style={styles.recDetail}>Why it matters: {sanitize(rec.why)}</Text>
                <Text style={styles.recDetail}>Risk if ignored: {sanitize(rec.risk)}</Text>
                <Text style={styles.recDetail}>Expected benefit: {sanitize(rec.benefit)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
      <Footer mspName={mspName} clientName={clientName} quarter={quarter} year={year} pageNum={pageNum} isWhiteLabel={isWhiteLabel} />
    </Page>
  )
}

function ClosingPage({ mspName, clientName, quarter, year, logoUrl, isWhiteLabel }: {
  mspName: string; clientName: string; quarter: string; year: number; logoUrl?: string; isWhiteLabel?: boolean
}) {
  return (
    <Page size="A4" orientation="landscape" style={styles.page}>
      <View style={styles.closingPage}>
        {logoUrl && <Image src={logoUrl} style={{ width: 120, height: 44, objectFit: 'contain', marginBottom: 24 }} />}
        <Text style={styles.closingTitle}>Thank you for your partnership.</Text>
        <Text style={styles.closingSubtitle}>{isWhiteLabel ? `${sanitize(mspName)} - Your Strategic IT Partner` : 'Generated with QBR Deck'}</Text>
        <View style={styles.closingGoldBar} />
        <Text style={styles.closingBody}>
          {"Let's schedule your Q" + (Number(quarter) === 4 ? 1 : Number(quarter) + 1) + " planning session to build on this quarter's progress.\n\nThis report was prepared exclusively for " + sanitize(clientName) + " and is confidential."}
        </Text>
      </View>
    </Page>
  )
}

export async function generatePDF(
  slides: QBRSlide[],
  clientName: string,
  quarter: string,
  year: number,
  mspName = 'QBR Deck',
  logoUrl?: string,
  input?: QBRInput,
  isWhiteLabel = false
): Promise<Buffer> {
  const health = input ? computeHealthScore(input) : { score: 0, status: 'N/A', summary: '' }

  const normalize = (text: string) => text.replace(/\{\{clientName\}\}/g, clientName)
  slides = slides.map(slide => ({
    ...slide,
    content: slide.content ? normalize(slide.content) : slide.content,
    bullets: slide.bullets?.map(normalize),
    recommendations: slide.recommendations?.map(rec => ({
      ...rec,
      why:     normalize(rec.why     ?? ''),
      risk:    normalize(rec.risk    ?? ''),
      benefit: normalize(rec.benefit ?? ''),
      title:   normalize(rec.title   ?? ''),
    })),
    priorities: slide.priorities ? {
      critical:  slide.priorities.critical?.map(normalize)  ?? [],
      important: slide.priorities.important?.map(normalize) ?? [],
      strategic: slide.priorities.strategic?.map(normalize) ?? [],
    } : undefined,
  }))

  const doc = (
    <Document>
      <CoverPage clientName={clientName} quarter={quarter} year={year} mspName={mspName} logoUrl={logoUrl} health={health} isWhiteLabel={isWhiteLabel} />
      {slides.map((slide, i) => (
        <ContentPage key={i} slide={slide} mspName={mspName} clientName={clientName} quarter={quarter} year={year} pageNum={i + 2} logoUrl={logoUrl} isWhiteLabel={isWhiteLabel} />
      ))}
      <ClosingPage mspName={mspName} clientName={clientName} quarter={quarter} year={year} logoUrl={logoUrl} isWhiteLabel={isWhiteLabel} />
    </Document>
  )

  const instance = pdf(doc)
  const blob = await instance.toBlob()
  const arrayBuffer = await blob.arrayBuffer()
  return Buffer.from(arrayBuffer)
}