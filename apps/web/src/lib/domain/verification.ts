/**
 * Verification Domain Module
 * 
 * The core verification pipeline for the election observation platform.
 * When Observer B submits a result for a polling unit where Observer A
 * already submitted, this module:
 * 
 * 1. Compares the two submissions
 * 2. Validates math (sum of party votes = valid votes)
 * 3. Processes OCR on uploaded photos (via NVIDIA API)
 * 4. Computes a confidence score
 * 5. Updates the result status
 */

import { createClient } from '@supabase/supabase-js';

// --- Types ---

export interface VoteSubmission {
  id: string;
  election_id: string;
  polling_unit_id: string;
  volunteer_id: string;
  assignment_id: string;
  valid_votes: number;
  rejected_votes: number;
  total_votes: number;
  status: string;
  submitted_at: string;
  party_results: PartyVote[];
}

export interface PartyVote {
  party_id: string;
  abbreviation: string;
  votes: number;
}

export interface ComparisonResult {
  match: boolean;
  partyComparisons: PartyComparison[];
  totalVotesMatch: boolean;
  validVotesMatch: boolean;
  rejectedVotesMatch: boolean;
  maxDiscrepancy: number;
}

export interface PartyComparison {
  party_id: string;
  abbreviation: string;
  votesA: number;
  votesB: number;
  match: boolean;
  difference: number;
}

export interface MathValidation {
  valid: boolean;
  partySumMatchesValidVotes: boolean;
  totalMatchesSum: boolean;
  totalNonNegative: boolean;
  errors: string[];
}

export interface OcrResult {
  success: boolean;
  extractedParties: Record<string, number>;
  extractedValidVotes: number;
  extractedRejectedVotes: number;
  extractedTotalVotes: number;
  confidence: number;
  rawText?: string;
  error?: string;
}

export interface VerificationScore {
  overall: 'HIGH' | 'MEDIUM' | 'LOW' | 'DISPUTED';
  mathValid: boolean;
  observerMatch: boolean | null; // null if only one observer
  ocrMatch: boolean | null;     // null if no photo
  ocrConfidence: number;
  signals: VerificationSignal[];
}

export interface VerificationSignal {
  name: string;
  passed: boolean;
  weight: number;
  details: string;
}

// --- Supabase Client ---

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://lgdubqovtyvzckvpbtrs.supabase.co';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// --- Math Validation ---

export function validateMath(submission: VoteSubmission): MathValidation {
  const errors: string[] = [];

  // Check party votes sum = valid votes
  const partySum = submission.party_results.reduce((sum, pr) => sum + pr.votes, 0);
  const partySumMatches = partySum === submission.valid_votes;
  if (!partySumMatches) {
    errors.push(`Party vote sum (${partySum}) does not equal valid votes (${submission.valid_votes})`);
  }

  // Check valid + rejected = total
  const totalMatches = submission.valid_votes + submission.rejected_votes === submission.total_votes;
  if (!totalMatches) {
    errors.push(`Valid (${submission.valid_votes}) + Rejected (${submission.rejected_votes}) does not equal total (${submission.total_votes})`);
  }

  // Check non-negative
  const nonNegative = submission.valid_votes >= 0 && submission.rejected_votes >= 0 && submission.total_votes >= 0;
  if (!nonNegative) {
    errors.push('Negative vote counts detected');
  }

  // Check party votes are non-negative
  const partyNonNegative = submission.party_results.every(pr => pr.votes >= 0);
  if (!partyNonNegative) {
    errors.push('Negative party vote counts detected');
  }

  return {
    valid: partySumMatches && totalMatches && nonNegative && partyNonNegative,
    partySumMatchesValidVotes: partySumMatches,
    totalMatchesSum: totalMatches,
    totalNonNegative: nonNegative,
    errors,
  };
}

// --- Two-Observer Comparison ---

export function compareObservers(
  submissionA: VoteSubmission,
  submissionB: VoteSubmission
): ComparisonResult {
  // Build party vote maps
  const votesA = new Map(submissionA.party_results.map(pr => [pr.party_id, pr.votes]));
  const votesB = new Map(submissionB.party_results.map(pr => [pr.party_id, pr.votes]));

  // Get all party IDs
  const allPartyIds = new Set([...votesA.keys(), ...votesB.keys()]);

  const partyComparisons: PartyComparison[] = [];
  let maxDiscrepancy = 0;

  for (const partyId of allPartyIds) {
    const vA = votesA.get(partyId) || 0;
    const vB = votesB.get(partyId) || 0;
    const diff = Math.abs(vA - vB);
    maxDiscrepancy = Math.max(maxDiscrepancy, diff);

    partyComparisons.push({
      party_id: partyId,
      abbreviation: '', // Will be filled in by caller
      votesA: vA,
      votesB: vB,
      match: vA === vB,
      difference: diff,
    });
  }

  const totalVotesMatch = submissionA.total_votes === submissionB.total_votes;
  const validVotesMatch = submissionA.valid_votes === submissionB.valid_votes;
  const rejectedVotesMatch = submissionA.rejected_votes === submissionB.rejected_votes;

  return {
    match: totalVotesMatch && validVotesMatch && rejectedVotesMatch && partyComparisons.every(pc => pc.match),
    partyComparisons,
    totalVotesMatch,
    validVotesMatch,
    rejectedVotesMatch,
    maxDiscrepancy,
  };
}

// --- OCR Processing (NVIDIA API) ---

export async function processOcr(imageUrl: string): Promise<OcrResult> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) {
    return { success: false, extractedParties: {}, extractedValidVotes: 0, extractedRejectedVotes: 0, extractedTotalVotes: 0, confidence: 0, error: 'NVIDIA_API_KEY not configured' };
  }

  try {
    // Download image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      return { success: false, extractedParties: {}, extractedValidVotes: 0, extractedRejectedVotes: 0, extractedTotalVotes: 0, confidence: 0, error: 'Failed to download image' };
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64 = Buffer.from(imageBuffer).toString('base64');

    // Call NVIDIA Build API
    const nvidiaUrl = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1';
    const response = await fetch(`${nvidiaUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'meta/llama-4-scout-17b-16e-instruct',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Extract all text from this Nigerian election result sheet (Form EC8A). Return ONLY a JSON object with these fields:
{
  "parties": {"APC": 182, "PDP": 143, "LP": 37, "NNPP": 12},
  "valid_votes": 362,
  "rejected_votes": 5,
  "total_votes": 367
}
If you cannot read certain fields, use null. Do not include any text outside the JSON.`,
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64}` },
              },
            ],
          },
        ],
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      return { success: false, extractedParties: {}, extractedValidVotes: 0, extractedRejectedVotes: 0, extractedTotalVotes: 0, confidence: 0, error: `NVIDIA API error: ${response.status}` };
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || '';

    // Parse JSON from response
    try {
      // Try to extract JSON from the response (might be wrapped in markdown)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { success: false, extractedParties: {}, extractedValidVotes: 0, extractedRejectedVotes: 0, extractedTotalVotes: 0, confidence: 0, error: 'No JSON found in OCR response', rawText: content };
      }

      const parsed = JSON.parse(jsonMatch[0]);
      return {
        success: true,
        extractedParties: parsed.parties || {},
        extractedValidVotes: parsed.valid_votes || 0,
        extractedRejectedVotes: parsed.rejected_votes || 0,
        extractedTotalVotes: parsed.total_votes || 0,
        confidence: 0.85,
        rawText: content,
      };
    } catch {
      return { success: false, extractedParties: {}, extractedValidVotes: 0, extractedRejectedVotes: 0, extractedTotalVotes: 0, confidence: 0, error: 'Failed to parse OCR response', rawText: content };
    }
  } catch (error) {
    return { success: false, extractedParties: {}, extractedValidVotes: 0, extractedRejectedVotes: 0, extractedTotalVotes: 0, confidence: 0, error: String(error) };
  }
}

// --- Compare OCR with Agent Submission ---

export function compareOcrWithSubmission(
  ocr: OcrResult,
  submission: VoteSubmission
): { match: boolean; discrepancies: string[] } {
  if (!ocr.success) {
    return { match: false, discrepancies: ['OCR processing failed'] };
  }

  const discrepancies: string[] = [];

  // Compare valid votes
  if (ocr.extractedValidVotes !== submission.valid_votes) {
    discrepancies.push(`Valid votes: OCR=${ocr.extractedValidVotes}, Agent=${submission.valid_votes}`);
  }

  // Compare rejected votes
  if (ocr.extractedRejectedVotes !== submission.rejected_votes) {
    discrepancies.push(`Rejected votes: OCR=${ocr.extractedRejectedVotes}, Agent=${submission.rejected_votes}`);
  }

  // Compare total votes
  if (ocr.extractedTotalVotes !== submission.total_votes) {
    discrepancies.push(`Total votes: OCR=${ocr.extractedTotalVotes}, Agent=${submission.total_votes}`);
  }

  // Compare party votes
  for (const pr of submission.party_results) {
    const ocrVotes = ocr.extractedParties[pr.abbreviation] ?? ocr.extractedParties[pr.party_id];
    if (ocrVotes !== undefined && ocrVotes !== pr.votes) {
      discrepancies.push(`${pr.abbreviation}: OCR=${ocrVotes}, Agent=${pr.votes}`);
    }
  }

  return {
    match: discrepancies.length === 0,
    discrepancies,
  };
}

// --- Confidence Scoring ---

export function computeConfidence(
  mathValid: boolean,
  comparison: ComparisonResult | null,
  ocrMatch: boolean | null,
  ocrConfidence: number,
  hasEvidence: boolean
): VerificationScore {
  const signals: VerificationSignal[] = [];
  let totalWeight = 0;
  let passedWeight = 0;

  // Signal 1: Math validation (weight: 30)
  const mathSignal: VerificationSignal = {
    name: 'Math Validation',
    passed: mathValid,
    weight: 30,
    details: mathValid ? 'Party sum matches valid votes, total matches sum' : 'Math validation failed',
  };
  signals.push(mathSignal);
  totalWeight += 30;
  if (mathValid) passedWeight += 30;

  // Signal 2: Two-observer match (weight: 40)
  if (comparison) {
    const observerSignal: VerificationSignal = {
      name: 'Observer Match',
      passed: comparison.match,
      weight: 40,
      details: comparison.match
        ? 'Both observers reported identical results'
        : `Discrepancy of ${comparison.maxDiscrepancy} votes`,
    };
    signals.push(observerSignal);
    totalWeight += 40;
    if (comparison.match) passedWeight += 40;
  }

  // Signal 3: OCR match (weight: 25)
  if (ocrMatch !== null) {
    const ocrSignal: VerificationSignal = {
      name: 'OCR Verification',
      passed: ocrMatch,
      weight: 25,
      details: ocrMatch ? 'OCR matches agent submission' : 'OCR shows discrepancies',
    };
    signals.push(ocrSignal);
    totalWeight += 25;
    if (ocrMatch) passedWeight += 25;
  }

  // Signal 4: Evidence uploaded (weight: 5)
  const evidenceSignal: VerificationSignal = {
    name: 'Evidence',
    passed: hasEvidence,
    weight: 5,
    details: hasEvidence ? 'Result sheet photo uploaded' : 'No photo uploaded',
  };
  signals.push(evidenceSignal);
  totalWeight += 5;
  if (hasEvidence) passedWeight += 5;

  // Calculate overall score
  const score = totalWeight > 0 ? (passedWeight / totalWeight) * 100 : 0;

  let overall: VerificationScore['overall'];
  if (score >= 90) overall = 'HIGH';
  else if (score >= 60) overall = 'MEDIUM';
  else if (score >= 30) overall = 'LOW';
  else overall = 'DISPUTED';

  return {
    overall,
    mathValid,
    observerMatch: comparison?.match ?? null,
    ocrMatch,
    ocrConfidence,
    signals,
  };
}

// --- Main Verification Pipeline ---

export async function verifyResult(resultId: string): Promise<{
  success: boolean;
  score?: VerificationScore;
  comparison?: ComparisonResult | null;
  ocrResult?: OcrResult | null;
  error?: string;
}> {
  const supabase = getSupabase();

  try {
    // 1. Fetch the result submission
    const { data: submission, error: fetchError } = await supabase
      .from('result_submissions')
      .select(`
        id, election_id, polling_unit_id, volunteer_id, assignment_id,
        valid_votes, rejected_votes, total_votes, status, submitted_at,
        party_results ( party_id, votes, parties ( abbreviation ) )
      `)
      .eq('id', resultId)
      .single();

    if (fetchError || !submission) {
      return { success: false, error: 'Result not found' };
    }

    // 2. Validate math
    const typedSubmission: VoteSubmission = {
      ...submission,
      party_results: (submission.party_results as any[]).map(pr => ({
        party_id: pr.party_id,
        abbreviation: pr.parties?.abbreviation || '',
        votes: pr.votes,
      })),
    };
    const mathResult = validateMath(typedSubmission);

    // 3. Check for second observer submission on same polling unit
    let comparison: ComparisonResult | null = null;
    const { data: otherSubmission } = await supabase
      .from('result_submissions')
      .select(`
        id, valid_votes, rejected_votes, total_votes, status,
        party_results ( party_id, votes, parties ( abbreviation ) )
      `)
      .eq('polling_unit_id', submission.polling_unit_id)
      .eq('election_id', submission.election_id)
      .neq('id', resultId)
      .in('status', ['UNVERIFIED', 'VERIFIED'])
      .order('submitted_at', { ascending: false })
      .limit(1)
      .single();

    if (otherSubmission) {
      const otherTyped: VoteSubmission = {
        ...otherSubmission,
        volunteer_id: '',
        assignment_id: '',
        election_id: submission.election_id,
        polling_unit_id: submission.polling_unit_id,
        submitted_at: '',
        party_results: (otherSubmission.party_results as any[]).map(pr => ({
          party_id: pr.party_id,
          abbreviation: pr.parties?.abbreviation || '',
          votes: pr.votes,
        })),
      };
      comparison = compareObservers(typedSubmission, otherTyped);
    }

    // 4. Check for evidence (photo uploaded)
    const { data: evidence } = await supabase
      .from('evidence_records')
      .select('id, file_id')
      .eq('parent_id', resultId)
      .limit(1)
      .single();

    const hasEvidence = !!evidence;

    // 5. Process OCR if evidence exists
    let ocrResult: OcrResult | null = null;
    let ocrMatch: boolean | null = null;

    if (hasEvidence && evidence?.file_id) {
      // Get signed URL for the evidence
      const { data: urlData } = await supabase.storage
        .from('evidence')
        .createSignedUrl(evidence.file_id, 300);

      if (urlData?.signedUrl) {
        ocrResult = await processOcr(urlData.signedUrl);
        if (ocrResult.success) {
          const ocrComparison = compareOcrWithSubmission(ocrResult, typedSubmission);
          ocrMatch = ocrComparison.match;
        }
      }
    }

    // 6. Compute confidence score
    const score = computeConfidence(
      mathResult.valid,
      comparison,
      ocrMatch,
      ocrResult?.confidence || 0,
      hasEvidence
    );

    // 7. Update result status
    const newStatus = score.overall === 'HIGH' ? 'VERIFIED'
      : score.overall === 'DISPUTED' ? 'DISPUTED'
      : 'UNVERIFIED'; // MEDIUM/LOW stay unverified for human review

    await supabase
      .from('result_submissions')
      .update({
        status: newStatus,
        verified_at: newStatus !== 'UNVERIFIED' ? new Date().toISOString() : null,
      })
      .eq('id', resultId);

    // 8. If two observers match and both are verified, also verify the other submission
    if (comparison?.match && newStatus === 'VERIFIED' && otherSubmission) {
      await supabase
        .from('result_submissions')
        .update({
          status: 'VERIFIED',
          verified_at: new Date().toISOString(),
        })
        .eq('id', otherSubmission.id);
    }

    // 9. Log audit event
    await supabase.from('audit_log').insert({
      actor_id: null,
      actor_type: 'SYSTEM',
      action: 'RESULT_VERIFIED',
      resource_type: 'result_submissions',
      resource_id: resultId,
      metadata: JSON.stringify({
        score: score.overall,
        math_valid: mathResult.valid,
        observer_match: comparison?.match ?? null,
        ocr_match: ocrMatch,
        signals: score.signals.map(s => `${s.name}: ${s.passed ? 'PASS' : 'FAIL'}`),
      }),
    });

    return { success: true, score, comparison, ocrResult };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}
