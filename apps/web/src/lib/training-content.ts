/**
 * Complete Agent Training Modules
 *
 * 5 modules × multiple sections each, with real scenarios and quizzes.
 * An agent MUST complete all 5 modules AND pass all quizzes
 * before they are eligible for polling-unit assignment.
 */

export interface TrainingSection {
  id: string;
  title: string;
  content: string[];          // paragraphs / bullet points
  callout?: string;           // highlighted tip or warning
  calloutType?: "tip" | "warning" | "info" | "legal";
  scenario?: {
    title: string;
    description: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  };
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
}

export interface TrainingModule {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;              // tailwind color class
  sections: TrainingSection[];
  quiz: QuizQuestion[];       // end-of-module quiz
  minQuizScore: number;       // minimum correct to pass (out of quiz.length)
}

export const TRAINING_MODULES: TrainingModule[] = [
  // ─────────────────────────────────────────────────
  // MODULE 1 — YOUR ROLE AS AN OBSERVER
  // ─────────────────────────────────────────────────
  {
    id: "role",
    title: "Your Role as an Observer",
    subtitle: "Who you are, what you can and cannot do, and the legal framework that protects you.",
    icon: "👤",
    color: "blue",
    sections: [
      {
        id: "role-1",
        title: "What Is a Polling Unit Observer?",
        content: [
          "You are a citizen volunteer trained to witness and document what happens at a polling unit on election day. You are not an election official — you do not run the process. You are not a party agent — you do not represent any candidate or party. You are an independent pair of eyes.",
          "Your job is to watch, record, and report. That is it. You watch the process from start to finish. You record what you see — through written notes, photographs, and the VoteWatch app. You report any irregularities through the proper channels.",
          "Nigeria's Electoral Act 2022 (Section 73) allows eligible citizens to serve as observers. However, domestic observers must be accredited by INEC through their organisation. This is why VoteWatch operates as an accredited observer organisation — your accreditation flows through our registration with INEC.",
        ],
        callout: "You are NOT an election official, a party agent, or a security officer. Your role is strictly to observe and report.",
        calloutType: "warning",
      },
      {
        id: "role-2",
        title: "Your Rights at the Polling Unit",
        content: [
          "As an accredited observer, you have the right to:",
          "• Enter the polling unit area and remain there throughout the voting, counting, and collation process",
          "• Watch the setup of materials, including the bimodal voter accreditation system (BVAS) and the result sheets (Form EC8A)",
          "• Observe the entire voting process without interference",
          "• Watch the counting of ballots after polls close",
          "• Observe the recording of results on the result sheet",
          "• Take photographs of the result sheet once it is declared and pasted",
          "• Move between the polling unit and the collation centre (within reason)",
          "You must carry your accreditation tag at all times. If asked to leave by INEC officials, ask for the reason in writing. If you believe your rights are being violated, use the Incident Report feature in the app immediately.",
        ],
        callout: "Always carry your VoteWatch accreditation badge visibly. It is your legal pass to be at the polling unit.",
        calloutType: "tip",
        scenario: {
          title: "Scenario: Denied Entry",
          description: "You arrive at your assigned polling unit. A party agent tells you that you cannot enter because 'this is APC territory' and there are already enough observers. The presiding officer does not intervene.",
          question: "What should you do?",
          options: [
            "Leave and report to your coordinator that you could not enter",
            "Argue with the party agent and demand entry",
            "Enter anyway by pushing past the agent",
            "Use the app's Incident Report feature to document the denial, photograph the scene from outside, and notify your coordinator immediately"
          ],
          correctIndex: 3,
          explanation: "You should never use force or get into a physical confrontation. Document the incident through the app, take photos if safe, and notify your coordinator. Your coordinator can escalate to INEC's situation room. You should also try to re-enter once the situation calms down, and if still denied, remain as close as possible to observe from outside.",
        },
      },
      {
        id: "role-3",
        title: "What You Cannot Do",
        content: [
          "Observer accreditation comes with strict conditions. Violating these can result in your accreditation being revoked and potential legal consequences:",
          "• You MUST NOT wear, display, or distribute any party-branded material (clothing, stickers, flags)",
          "• You MUST NOT canvas for or against any candidate within the polling unit or its environs",
          "• You MUST NOT interfere with the voting process — do not touch ballot papers, do not direct voters on how to vote",
          "• You MUST NOT attempt to influence the counting or recording of results",
          "• You MUST NOT remove any election materials from the polling unit",
          "• You MUST NOT photograph a voter's ballot while they are marking it (secret ballot protection)",
          "• You MUST NOT confront, threaten, or physically engage with anyone",
          "• You MUST NOT wear a mask or face covering that hides your identity (in some states)",
          "The bottom line: observe, record, report. Nothing else.",
        ],
        callout: "If you campaign for any party within 500m of a polling unit, your accreditation can be revoked and you may face prosecution under the Electoral Act.",
        calloutType: "legal",
      },
      {
        id: "role-4",
        title: "The Two-Observer Model",
        content: [
          "VoteWatch uses a two-observer verification system. Each polling unit should have up to 2 independent observers. This is not redundancy — it is a deliberate safeguard.",
          "Observer #1 is the primary observer. They are responsible for being present from setup to collation, documenting the full process, and submitting the first set of results.",
          "Observer #2 is the verifying observer. They independently document the same process. Their results are compared against Observer #1's submission. If both reports match, the result receives a 'Verified' status. If they differ, the result is flagged for manual review.",
          "This system exists because a single observer can be compromised, mistaken, or unable to capture everything. Two independent observers dramatically increase the reliability of the data.",
          "If you are assigned as Observer #2, your role is equally important. You are not a backup — you are a co-equal verifier. Take your observation as seriously as Observer #1.",
        ],
        callout: "Your observations are compared with another observer's. Accuracy and honesty matter more than speed.",
        calloutType: "info",
        scenario: {
          title: "Scenario: Conflicting Results",
          description: "You are Observer #1. You record 142 votes for Candidate A on the Form EC8A. Observer #2 records 148. The presiding officer's sheet shows 145. What happens?",
          question: "What is the correct outcome?",
          options: [
            "The system uses your number because you are Observer #1",
            "The system uses Observer #2's number because they verified",
            "The system flags the discrepancy for manual review — all three numbers are recorded and an admin reviews the evidence",
            "The system averages the three numbers"
          ],
          correctIndex: 2,
          explanation: "When observer reports disagree, the system flags the result for manual review. All submitted numbers (yours, Observer #2's, and the presiding officer's) are recorded. An admin will review the photographs of the Form EC8A to determine the correct figure. This is exactly why the two-observer model exists — to catch discrepancies.",
        },
      },
    ],
    minQuizScore: 4,
    quiz: [
      {
        id: "role-q1",
        question: "What is your primary role at a polling unit?",
        options: [
          "Run the voting process on behalf of INEC",
          "Ensure your party's candidate wins",
          "Watch, record, and report what you observe",
          "Count the votes and announce the winner"
        ],
        correctIndex: 2,
        explanation: "Your role is strictly to observe, record, and report. You do not run the process, represent a party, or count votes.",
      },
      {
        id: "role-q2",
        question: "A party agent asks you to leave the polling unit. What is the correct response?",
        options: [
          "Leave immediately without question",
          "Push past the agent and enter",
          "Document the incident in the app, photograph the scene, and notify your coordinator",
          "Argue with the agent until they let you in"
        ],
        correctIndex: 2,
        explanation: "Never use force. Document the denial, take photos if safe, and notify your coordinator who can escalate to INEC.",
      },
      {
        id: "role-q3",
        question: "Can you photograph a voter's ballot while they are marking it?",
        options: [
          "Yes, as long as you are an accredited observer",
          "Yes, but only if the voter consents",
          "No — the secret ballot must be protected",
          "Yes, but only for the presiding officer's records"
        ],
        correctIndex: 2,
        explanation: "Never photograph a voter's ballot while they are marking it. This violates the secret ballot principle and is prohibited under Nigerian electoral law.",
      },
      {
        id: "role-q4",
        question: "Why does VoteWatch assign two observers to each polling unit?",
        options: [
          "Because INEC requires exactly two observers per unit",
          "In case one observer is late or absent",
          "For independent verification — if both reports match, the result is verified",
          "Because the app needs two people to operate it"
        ],
        correctIndex: 2,
        explanation: "Two observers provide independent verification. Matching reports increase confidence in the data. Conflicting reports trigger manual review.",
      },
      {
        id: "role-q5",
        question: "Which of the following is NOT allowed for an accredited observer?",
        options: [
          "Taking photographs of the posted Form EC8A",
          "Wearing a T-shirt with a party logo",
          "Using the app to report an incident",
          "Remaining at the polling unit during counting"
        ],
        correctIndex: 1,
        explanation: "Wearing party-branded material is strictly prohibited. It violates your observer neutrality and can result in accreditation revocation.",
      },
    ],
  },

  // ─────────────────────────────────────────────────
  // MODULE 2 — ELECTION DAY PROCEDURES
  // ─────────────────────────────────────────────────
  {
    id: "procedures",
    title: "Election Day Procedures",
    subtitle: "Step-by-step guide from arrival at dawn to the final result — what happens at each stage and what you must observe.",
    icon: "📋",
    color: "emerald",
    sections: [
      {
        id: "proc-1",
        title: "Before Election Day: Preparation",
        content: [
          "Your work starts before election day. Here is your preparation checklist:",
          "• Confirm your assignment in the app — check your polling unit code, name, and location",
          "• Visit your polling unit before election day if possible. Note the physical layout: entry/exit points, where the presiding officer sets up, where voters queue, where results are posted",
          "• Charge your phone to 100%. Bring a power bank. Your phone IS your observation tool",
          "• Download the VoteWatch app data for offline use — your assignment details, PU info, and emergency contacts should be cached",
          "• Wear comfortable, neutral clothing. No party colours. No uniforms. Plain clothes are best",
          "• Bring water, snacks, and any medication you need. You will be there for 12+ hours",
          "• Print or save your VoteWatch accreditation badge. You will need it to enter",
          "• Know your coordinator's phone number by heart or written down — do not rely solely on your phone",
        ],
        callout: "Visit your polling unit before election day. Familiarise yourself with the layout so you know where to stand and what to watch.",
        calloutType: "tip",
      },
      {
        id: "proc-2",
        title: "Arrival and Setup (5:00 AM – 7:00 AM)",
        content: [
          "Arrive at your polling unit no later than 6:00 AM on election day. Setup begins early and you need to witness it.",
          "When you arrive:",
          "• Check in using the app's GPS check-in feature. This proves you are at the correct location",
          "• Introduce yourself to the presiding officer. Show your accreditation badge. Ask if Observer #2 has arrived",
          "• Observe the setup of election materials: ballot boxes (empty and sealed), BVAS device, Form EC8A (result sheet), ink pads, stamp pads, and indelible ink",
          "• Verify that the ballot boxes are empty before they are sealed. Watch the presiding officer hold them up and show the interior",
          "• Check that the BVAS device is working — it should display the polling unit code and ward when activated",
          "• Note the time of setup. Record any irregularities: late arrival of materials, missing items, unsealed boxes, or unauthorized persons handling materials",
          "• Photograph the empty ballot boxes, the BVAS screen, and the posted voter register",
        ],
        callout: "The presiding officer must show that ballot boxes are empty before sealing them. If this does not happen, report it immediately.",
        calloutType: "warning",
        scenario: {
          title: "Scenario: Missing Materials",
          description: "The presiding officer arrives at 6:30 AM but the BVAS device is not working. The battery is dead and there is no backup. There are 800 registered voters waiting.",
          question: "What should you record and report?",
          options: [
            "Nothing — it is not your problem, it is INEC's",
            "Note the time, record the issue in the app with a photo, report to your coordinator, and continue observing whatever INEC does next",
            "Demand that voting cannot proceed until the BVAS is fixed",
            "Leave because the process is invalid"
          ],
          correctIndex: 1,
          explanation: "You must record and report what you observe. A non-functional BVAS is a significant irregularity. Document it (time, photos, description) and report through the app. Do not leave — continue observing. INEC may deploy a replacement or use manual accreditation. Your job is to witness whatever happens.",
        },
      },
      {
        id: "proc-3",
        title: "Voting Process (8:30 AM – 2:30 PM)",
        content: [
          "Polling typically opens at 8:30 AM and closes at 2:30 PM (confirm times with your presiding officer, as they vary by state).",
          "During voting, observe and record:",
          "• Voter accreditation: each voter presents their PVC, the BVAS verifies their identity (fingerprint or face), and they are given a ballot",
          "• The number of voters accredited vs. the number of ballots issued — these should match",
          "• The voting area: voters should mark ballots in secret, fold them, and drop them into the sealed ballot box in full view of observers",
          "• Any voter who is turned away — note the reason if visible (no PVC, failed BVAS, wrong PU)",
          "• Any person who votes without going through BVAS accreditation",
          "• Any presiding officer or party agent who enters the voting cubicle with a voter",
          "• Any distribution of money, food, or gifts near the polling unit",
          "• Any intimidation or harassment of voters",
          "• The queue: note approximate queue length at regular intervals (every hour). Long queues that are not processed indicate potential suppression",
          "• Accessibility: are elderly, disabled, or pregnant voters being given priority?",
          "Take photos periodically — queue length, the BVAS device in action, the ballot box, and the overall scene. Always photograph from a respectful distance.",
        ],
        callout: "Note the queue length every hour. A shrinking queue is normal. A growing queue after midday may indicate deliberate delays.",
        calloutType: "tip",
        scenario: {
          title: "Scenario: Vote Buying",
          description: "You notice a man standing 200 metres from the polling unit handing out ₦500 notes to voters as they leave. He is not wearing any party colours, but you overhear him say 'Thank you for supporting the struggle.'",
          question: "What should you do?",
          options: [
            "Confront the man and demand he stops",
            "Ignore it — it is outside the polling unit",
            "Document the time, take a photo if safe, note the man's description, and report through the app's Incident Report feature",
            "Report to the presiding officer"
          ],
          correctIndex: 2,
          explanation: "Vote buying is a crime under the Electoral Act 2022 (Section 127). You should document it — time, location, description, photos if safe — and report through the app. Do not confront the person. You can also mention it to the presiding officer, but your primary channel is the app's Incident Report.",
        },
      },
      {
        id: "proc-4",
        title: "Counting Process (After 2:30 PM)",
        content: [
          "Counting begins after the presiding officer announces that polls have closed. This is the most critical observation period.",
          "The counting process:",
          "• The presiding officer opens the ballot box in full view of all observers and party agents",
          "• Ballots are sorted by party — one pile per candidate/party",
          "• Each ballot is examined: valid votes are counted, spoiled ballots are set aside",
          "• The count for each party is announced verbally and recorded on Form EC8A",
          "• Both you and Observer #2 should independently record the count for each party",
          "• After recording, the presiding officer pastes the Form EC8A at the polling unit for public view",
          "• You should photograph the posted Form EC8A immediately — this is your primary evidence",
          "Things to watch for during counting:",
          "• Any ballot that is torn, marked in multiple places, or has no ink mark should be rejected — watch that rejections are fair",
          "• Any ballot box that was not sealed at the start",
          "• Any ballot papers that appear pre-marked or pre-stuffed",
          "• Any person other than the presiding officer who handles the ballot papers during counting",
          "• The final tally on Form EC8A should match what you and Observer #2 recorded",
          "Record the time counting started and ended. A very fast count for a large number of voters may indicate irregularity.",
        ],
        callout: "Photograph the Form EC8A the moment it is posted. Do not wait. The image may be your most important piece of evidence.",
        calloutType: "warning",
      },
      {
        id: "proc-5",
        title: "Result Collation and Departure",
        content: [
          "After counting, the results are collated and submitted. Here is what happens next:",
          "• The presiding officer signs Form EC8A and gives copies to party agents",
          "• The original Form EC8A and the ballot papers are packed into tamper-evident envelopes",
          "• The presiding officer, accompanied by party agents, transports the results to the Ward Collation Centre",
          "• As an observer, you may follow the results to the Ward Collation Centre if it is nearby",
          "• At the Ward Centre, results from all polling units in the ward are aggregated onto Form EC8B",
          "• You should submit your final observation report through the app before leaving",
          "Before you leave:",
          "• Make sure your result submission in the app matches the Form EC8A you photographed",
          "• Verify Observer #2 has also submitted their results",
          "• Check out using the app's GPS check-out feature",
          "• Note the time of your departure",
          "• If you witnessed any irregularities, make sure they are documented in the Incident Report before you leave",
          "Do NOT leave until you are certain your data has been submitted. If you lose network connectivity, the app will queue your submission and send it when you reconnect.",
        ],
        callout: "Never leave without submitting your results and incident reports. Queued submissions may arrive late and lose context.",
        calloutType: "tip",
      },
    ],
    minQuizScore: 4,
    quiz: [
      {
        id: "proc-q1",
        question: "What time should you arrive at your polling unit on election day?",
        options: [
          "8:00 AM, when voting starts",
          "7:00 AM, to watch the queue form",
          "No later than 6:00 AM, to observe the full setup",
          "Whenever you can — timing does not matter"
        ],
        correctIndex: 2,
        explanation: "You must arrive by 6:00 AM to witness the setup of materials, including the empty ballot box demonstration and BVAS activation.",
      },
      {
        id: "proc-q2",
        question: "What is the most important photograph to take during the entire election day?",
        options: [
          "A selfie at the polling unit",
          "The presiding officer",
          "The posted Form EC8A immediately after results are announced",
          "The queue of voters"
        ],
        correctIndex: 2,
        explanation: "The Form EC8A is the official result sheet. Your photograph of it is the primary evidence that your reported numbers are correct.",
      },
      {
        id: "proc-q3",
        question: "You notice a man distributing money to voters 200m from the polling unit. What should you do?",
        options: [
          "Confront him directly",
          "Ignore it — it is outside the PU boundary",
          "Document it and report through the app's Incident Report",
          "Take the money and report later"
        ],
        correctIndex: 2,
        explanation: "Vote buying is a crime. Document the incident (time, description, photos if safe) and report through the app. Never confront the person or accept money.",
      },
      {
        id: "proc-q4",
        question: "During counting, you notice the presiding officer has set aside 15 ballots as 'spoiled'. Your independent count shows only 8 should be rejected. What should you do?",
        options: [
          "Accept the presiding officer's count — they are the authority",
          "Leave and report to your coordinator only",
          "Record your observation, photograph the spoiled ballots if possible, note the discrepancy in the app, and submit it with your result",
          "Demand the presiding officer recount in front of you"
        ],
        correctIndex: 2,
        explanation: "Record the discrepancy. Photograph the spoiled ballots if safe. Document your observation in the app. Your report, combined with Observer #2's independent count, creates a verifiable record.",
      },
      {
        id: "proc-q5",
        question: "When should you submit your final observation report?",
        options: [
          "The next morning",
          "When you get home",
          "Before leaving the polling unit area — while all details are fresh and your photos are available",
          "Whenever you feel like it"
        ],
        correctIndex: 2,
        explanation: "Always submit before leaving. Details fade quickly, and you may lose access to the polling unit. Make sure your result submission matches the Form EC8A photograph.",
      },
    ],
  },

  // ─────────────────────────────────────────────────
  // MODULE 3 — USING THE VOTEWATCH APP
  // ─────────────────────────────────────────────────
  {
    id: "app",
    title: "Using the VoteWatch App",
    subtitle: "How to check in, submit results, upload evidence, and report incidents — step by step.",
    icon: "📱",
    color: "violet",
    sections: [
      {
        id: "app-1",
        title: "Logging In and Checking In",
        content: [
          "When you open the VoteWatch app on election day, here is what to do:",
          "Step 1 — Log In: Use your Google account (the same one you registered with). If you are already logged in, you will go straight to your dashboard.",
          "Step 2 — Check Your Assignment: Your dashboard shows your polling unit code, name, and status. Verify this matches the polling unit you are physically at.",
          "Step 3 — Check In With GPS: Tap the 'Check In With GPS' button. The app will request your location. Hold your phone steady and wait for GPS lock.",
          "The app measures your distance from the polling unit's registered coordinates. You must be within 2 km to check in successfully. If you are further away, the app will show how far you are and ask you to move closer.",
          "Step 4 — Verification: Your check-in is recorded with your GPS coordinates, accuracy reading, and timestamp. This data proves you were physically present at the polling unit.",
          "If GPS is not available (poor signal, indoor location), try moving to an open area. If GPS consistently fails, check in manually and note the issue — your coordinator will verify your presence separately.",
        ],
        callout: "Check in immediately upon arrival. The GPS timestamp is your proof of presence. Do not check in from home or from a different location.",
        calloutType: "warning",
      },
      {
        id: "app-2",
        title: "Submitting Results",
        content: [
          "After the presiding officer posts the Form EC8A, you submit your results through the app:",
          "Step 1 — Open Result Submission: From your dashboard, tap 'Submit Result'. You will see a form listing all parties/candidates in the election.",
          "Step 2 — Enter Vote Counts: For each party, enter the number of votes you recorded from the Form EC8A. Be precise — do not round or estimate. Enter the exact number you wrote down.",
          "Step 3 — Upload Photos: Attach your photographs of the Form EC8A. The app requires at least one clear photo of the full result sheet. Take additional close-up photos of the totals section.",
          "Step 4 — Add Notes: If there were any irregularities during counting (e.g., disputed ballots, presiding officer errors), add them in the notes field.",
          "Step 5 — Submit: Review your entries, then tap Submit. The app will send your results to the VoteWatch verification server.",
          "Important: Your result submission is compared against Observer #2's independent submission. If both match, the result is marked as 'Verified'. If they differ, an admin will review the photographs to determine the correct numbers.",
          "Do NOT submit estimated numbers. If you are unsure about a count, note the uncertainty in your submission. Honesty is more valuable than precision.",
        ],
        callout: "Enter the exact numbers from the Form EC8A. Do not estimate, round, or copy from party agents. Your data must be your own independent observation.",
        calloutType: "warning",
        scenario: {
          title: "Scenario: Unclear Result",
          description: "The Form EC8A is partially obscured by a tear. You can read most numbers clearly, but the vote count for Party C looks like either 87 or 97. The ink is smudged.",
          question: "What should you do in your result submission?",
          options: [
            "Enter 87 because it is the lower number",
            "Enter 97 because it is the higher number",
            "Enter your best reading and note the uncertainty in the remarks field, and describe what you see in your photo evidence",
            "Leave Party C blank and move on"
          ],          correctIndex: 2,
          explanation: "Always note uncertainty honestly. Enter your best reading, describe the issue in the remarks, and let the verification process (Observer #2 comparison + admin review) determine the final number.",
        },
      },

      {
        id: "app-3",
        title: "Uploading Evidence",
        content: [
          "The app allows you to upload photographs and short text descriptions as evidence. Here is what to photograph and when:",
          "During Setup (6:00–8:30 AM):",
          "• Empty ballot boxes before sealing",
          "• The BVAS device screen showing your polling unit code",
          "• The posted voter register",
          "• The polling unit layout (wide shot)",
          "During Voting (8:30 AM–2:30 PM):",
          "• Queue length (every hour)",
          "• The BVAS device in use (if visible from your position)",
          "• Any irregularities you observe (do NOT photograph voters' ballots)",
          "During Counting (after 2:30 PM):",
          "• The sorting of ballots into party piles",
          "• The final count for each party as announced",
          "• The completed Form EC8A — this is your MOST IMPORTANT photo",
          "• The posted Form EC8A after it is displayed publicly",
          "Photo Tips:",
          "• Hold your phone horizontally for wider shots",
          "• Ensure text on documents is readable — zoom in if needed",
          "• Avoid using flash during counting (it can disturb the process)",
          "• Take multiple shots of the same document — one will be clearer",
          "• The app automatically timestamps and geo-tags your photos",
        ],
        callout: "The Form EC8A photograph is your single most important piece of evidence. Take it immediately when posted. Take multiple shots.",
        calloutType: "tip",
      },
      {
        id: "app-4",
        title: "Reporting Incidents",
        content: [
          "The Incident Report feature is your way to document anything unusual, problematic, or illegal that you witness. Use it for:",
          "• Voter intimidation or harassment",
          "• Vote buying or bribery",
          "• Ballot box stuffing or tampering",
          "• Destruction of election materials",
          "• Presence of unauthorized armed persons",
          "• Prevention of observers from entering the polling unit",
          "• BVAS malfunction or abuse",
          "• Presiding officer misconduct",
          "• Any situation where you feel unsafe",
          "How to file an incident report:",
          "Step 1 — Tap 'Report Incident' from your dashboard",
          "Step 2 — Select the incident type from the category list",
          "Step 3 — Write a clear, factual description. Stick to what you saw and heard — do not include opinions or assumptions",
          "Step 4 — Attach photos or videos if safe to do so",
          "Step 5 — Submit. The report is sent to your coordinator and the VoteWatch situation room in real-time",
          "Critical rule: Report first, discuss later. If you see something wrong, file the report immediately through the app. Do not wait until you leave the polling unit. Memory fades and context is lost.",
        ],
        callout: "Always report incidents in real-time. A report filed hours later loses critical detail and cannot be verified by the system.",
        calloutType: "warning",
      },
      {
        id: "app-5",
        title: "Safety Features",
        content: [
          "The app has built-in safety features designed to protect you in dangerous situations:",
          "PANIC BUTTON — 'I Feel Unsafe'",
          "If you feel physically threatened, tap the red 'I Feel Unsafe' button at the bottom of your dashboard. This immediately:",
          "• Sends your GPS coordinates to your coordinator and the situation room",
          "• Notifies all VoteWatch administrators in the area",
          "• Logs your last known position with a timestamp",
          "• Records audio for 30 seconds (if you grant microphone permission)",
          "Use this button if you are being threatened, if armed persons appear, or if the situation becomes physically dangerous. Do not wait to assess the situation — use it at the first sign of danger.",
          "CHECK-OUT",
          "When you leave the polling unit at the end of the day, use the Check-Out button. This records your departure time and final GPS position.",
          "OFFLINE MODE",
          "If you lose internet connectivity, the app stores all your data locally. When you reconnect, everything syncs automatically. You do not need to redo anything.",
          "Do NOT disable location services on your phone during election day. Your GPS data is your alibi — it proves you were where you said you were.",
        ],
        callout: "If you feel unsafe, press the panic button FIRST. Your safety is more important than any data you could collect.",
        calloutType: "warning",
        scenario: {
          title: "Scenario: Threatening Situation",
          description: "During counting, a group of men in party-branded clothing enter the polling unit and begin shouting at the presiding officer. One of them is carrying a stick. Other voters are leaving.",
          question: "What is your immediate action?",
          options: [
            "Stand your ground and keep observing",
            "Press the 'I Feel Unsafe' button and move to a safe distance while continuing to observe",
            "Confront the men and tell them to leave",
            "Run away immediately and abandon your phone"
          ],
          correctIndex: 1,
          explanation: "Your safety comes first. Press the panic button to alert your coordinator and the situation room. Move to a safe distance — do not abandon your phone, as it contains your GPS tracker and evidence. Continue observing from safety if possible. Never confront armed or threatening individuals.",
        },
      },
    ],
    minQuizScore: 4,
    quiz: [
      {
        id: "app-q1",
        question: "What happens when you tap 'Check In With GPS'?",
        options: [
          "It sends a text message to your coordinator",
          "It records your GPS coordinates, distance from the PU, and timestamp as proof of presence",
          "It starts recording video",
          "It sends your location to INEC"
        ],
        correctIndex: 1,
        explanation: "GPS check-in records your coordinates, measures your distance from the polling unit (must be within 2km), and timestamps the check-in as proof of physical presence.",
      },
      {
        id: "app-q2",
        question: "What is the most important photograph to take on election day?",
        options: [
          "The presiding officer's face",
          "Your accreditation badge",
          "The posted Form EC8A",
          "The voting queue"
        ],
        correctIndex: 2,
        explanation: "The Form EC8A is the official result sheet. Your photograph of it is the primary evidence for verifying your submitted results.",
      },
      {
        id: "app-q3",
        question: "You lose internet connectivity at 3:00 PM. What happens to the data you collected?",
        options: [
          "It is lost forever",
          "It is saved locally and syncs when you reconnect",
          "You need to re-enter everything",
          "It is sent via SMS"
        ],
        correctIndex: 1,
        explanation: "The app stores all data locally when offline. Everything syncs automatically when you reconnect. You do not need to redo anything.",
      },
      {
        id: "app-q4",
        question: "When should you press the 'I Feel Unsafe' button?",
        options: [
          "Only if someone points a gun at you",
          "At the first sign of physical danger — threats, armed persons, or crowd violence",
          "Only after you have left the area",
          "When your phone battery is low"
        ],
        correctIndex: 1,
        explanation: "Use the panic button at the FIRST sign of danger. It alerts your coordinator and situation room with your GPS coordinates. Do not wait for the situation to escalate.",
      },
      {
        id: "app-q5",
        question: "The Form EC8A shows 156 votes for Party A, but you are not sure if the last digit is a 6 or an 8. What should you do?",
        options: [
          "Enter 156 and do not mention the uncertainty",
          "Enter 158 because it is the higher number",
          "Enter your best reading and note the uncertainty in the remarks field, with a description of the smudge",
          "Leave Party A blank"
        ],
        correctIndex: 2,
        explanation: "Always note uncertainty honestly. Enter your best reading, describe the issue in the remarks, and let the verification process (Observer #2 comparison + admin review) determine the final number.",
      },
    ],
  },

  // ─────────────────────────────────────────────────
  // MODULE 4 — EVIDENCE & REPORTING STANDARDS
  // ─────────────────────────────────────────────────
  {
    id: "evidence",
    title: "Evidence & Reporting Standards",
    subtitle: "How to write clear observations, what makes evidence credible, and how your data feeds into the public dashboard.",
    icon: "📷",
    color: "amber",
    sections: [
      {
        id: "ev-1",
        title: "What Makes Evidence Credible?",
        content: [
          "Your observations become part of the public record. Credible evidence must be:",
          "TIMELY — Recorded at the time of the event, not hours later. The app timestamps everything automatically, which is why you must file reports in real-time.",
          "FACTUAL — Based on what you personally saw and heard. Not what someone told you. Not what you assumed. Not what you think happened. Write: 'I saw the presiding officer hand a ballot to a person who did not present a PVC.' Do not write: 'The presiding officer was rigging.'",
          "SPECIFIC — Include names, codes, times, and descriptions. Write: 'At approximately 11:45 AM, a man in a red cap approached voters in the queue and distributed ₦500 notes.' Not: 'Someone was buying votes around noon.'",
          "VERIFIABLE — Supported by photographs, timestamps, and GPS data. Your phone provides all three automatically when you use the app correctly.",
          "COMPLETE — Include all relevant details, even ones that seem minor. A detail you think is unimportant may be the key to understanding a larger pattern.",
          "The golden rule: Write your observation as if you are describing it to someone who was not there and needs to understand exactly what happened.",
        ],
        callout: "Write what you SAW and HEARD, not what you THINK happened. 'I observed' is always more powerful than 'I believe.'",
        calloutType: "tip",
        scenario: {
          title: "Scenario: Writing an Observation",
          description: "You witness a party agent standing inside the voting area, looking at voters' ballots as they mark them. The presiding officer does not stop him.",
          question: "Which observation note is most useful?",
          options: [
            "Party agent was cheating",
            "At approximately 10:15 AM, a man wearing a blue cap and white shirt stood approximately 2 metres from the voting table, facing voters as they marked their ballots. He appeared to be observing their choices. The presiding officer was present but did not intervene. I photographed the scene from approximately 5 metres away.",
            "The election was rigged at my polling unit",
            "Someone was watching people vote and the INEC officer did nothing"
          ],
          correctIndex: 1,
          explanation: "The second option is the gold standard: specific time, physical description, exact position, what you observed, what the official did, and that you took photographic evidence. This is actionable, verifiable information.",
        },
      },
      {
        id: "ev-2",
        title: "Photography Best Practices",
        content: [
          "Your photographs are your strongest evidence. Follow these rules:",
          "CLARITY — Ensure text in photographs is readable. Hold your phone steady. Use natural light when possible. Zoom in on important sections of documents.",
          "COMPLETENESS — For the Form EC8A, photograph the entire document first, then take close-ups of the totals section and any areas with corrections or amendments.",
          "CONTEXT — Take wide shots that show the overall scene, then zoom in for details. A wide shot of the counting area provides context for close-up photos of the result sheet.",
          "SEQUENCE — Photograph events in order: setup → voting → counting → result posting. This creates a timeline that supports your narrative.",
          "METADATA — The app automatically records GPS coordinates and timestamps. Do not edit or crop photos in a way that removes this metadata.",
          "RESPECT — Never photograph voters' ballots while they are marking them. Never photograph people in distress. Never photograph inside private spaces.",
          "STORAGE — Your photos are stored locally until you submit them. Do not delete photos from your phone until your submission is confirmed as received.",
        ],
        callout: "Take multiple photographs of the Form EC8A. One wide shot, one close-up of the totals, and one close-up of any corrections or amendments.",
        calloutType: "tip",
      },
      {
        id: "ev-3",
        title: "Writing Incident Reports",
        content: [
          "Incident reports are formal records of irregularities. They are reviewed by administrators and may be shared with security agencies or legal teams. Write them professionally.",
          "Structure of a good incident report:",
          "1. WHAT happened — describe the event in plain, factual language",
          "2. WHEN it happened — give the approximate time (e.g., 'around 10:15 AM')",
          "3. WHERE it happened — your polling unit code, name, and specific location (e.g., 'at the entrance to the voting area')",
          "4. WHO was involved — physical descriptions (clothing, build, age range). Do not name people unless you know them",
          "5. WITNESSES — were other people present? How many? Did they intervene?",
          "6. EVIDENCE — what photos did you take? What did you record in the app?",
          "7. IMPACT — what was the effect on the voting process? Did voters leave? Were votes affected?",
          "8. FOLLOW-UP — what happened after the incident? Did officials respond? Did the situation change?",
          "Avoid editorializing. Do not say 'This was clearly intentional rigging.' Say 'I observed [specific action] at [specific time] by [specific person]. The presiding officer [specific response or lack of response].'",
        ],
        callout: "An incident report is not an opinion piece. Stick to facts, times, and descriptions. Let the evidence speak.",
        calloutType: "warning",
      },
      {
        id: "ev-4",
        title: "How Your Data Feeds the Public Dashboard",
        content: [
          "When you submit results through the app, here is what happens to your data:",
          "Step 1 — Your result submission arrives at the VoteWatch verification server along with Observer #2's independent submission.",
          "Step 2 — If both submissions match, the result is marked as 'Verified' and immediately published to the public dashboard.",
          "Step 3 — If submissions differ, the result is marked as 'Disputed' and an admin reviews the photographic evidence to determine the correct numbers.",
          "Step 4 — Your photographs are stored as evidence and linked to the result record. They can be accessed by admins for verification and by the public for transparency.",
          "Step 5 — The public dashboard updates in real-time. As verified results come in, the map fills with coloured dots, the party leaderboard updates, and the state-by-state breakdown populates.",
          "Step 6 — Your GPS check-in data appears on the admin's agent location map, showing where observers are deployed across the country.",
          "This means your accuracy directly affects what millions of people see on election day. Every number you submit, every photo you take, every incident you report becomes part of the national record.",
          "There is no pressure — but there is responsibility. Be accurate. Be honest. Be thorough.",
        ],
        callout: "Your data feeds a live dashboard that millions will watch. Accuracy and honesty are your most important tools.",
        calloutType: "info",
      },
    ],
    minQuizScore: 4,
    quiz: [
      {
        id: "ev-q1",
        question: "What makes evidence credible?",
        options: [
          "It is dramatic and emotional",
          "It supports a particular party's narrative",
          "It is timely, factual, specific, verifiable, and complete",
          "It is posted on social media quickly"
        ],
        correctIndex: 2,
        explanation: "Credible evidence is timely (recorded at the time), factual (based on what you saw), specific (names, times, descriptions), verifiable (photos, GPS, timestamps), and complete.",
      },
      {
        id: "ev-q2",
        question: "You see a party agent giving money to voters. Which incident report is most useful?",
        options: [
          "Rigging happening at PU 001",
          "At approximately 11:45 AM, a man in a red cap and blue shirt distributed what appeared to be ₦500 notes to approximately 8 voters leaving the voting area. The presiding officer was inside the voting area and did not intervene. I photographed the man from approximately 10 metres away.",
          "Vote buying is bad and must stop",
          "Someone gave people money near my polling unit"
        ],
        correctIndex: 1,
        explanation: "The second option provides specific time, physical description, approximate number of people involved, what the official did, and that you took photographic evidence. This is actionable and verifiable.",
      },
      {
        id: "ev-q3",
        question: "What happens when Observer #1 and Observer #2 submit different vote counts?",
        options: [
          "Observer #1's count is used automatically",
          "Observer #2's count is used automatically",
          "The numbers are averaged",
          "The result is flagged for manual admin review using the photographic evidence"
        ],
        correctIndex: 3,
        explanation: "Conflicting submissions trigger manual review. An admin compares the photographic evidence (Form EC8A) against both submissions to determine the correct numbers.",
      },
      {
        id: "ev-q4",
        question: "When should you take photographs during election day?",
        options: [
          "Only at the end during counting",
          "At every stage: setup, voting, counting, and result posting",
          "Only when something goes wrong",
          "Only of the Form EC8A"
        ],
        correctIndex: 1,
        explanation: "Photograph at every stage. Setup photos prove the boxes were empty. Voting photos show the process. Counting photos capture the count. Result photos are your primary evidence.",
      },
      {
        id: "ev-q5",
        question: "You write an observation note. Which phrasing is correct?",
        options: [
          "The election was rigged at my polling unit",
          "I believe there was fraud",
          "At approximately 10:15 AM, I observed the presiding officer hand a ballot paper to a person who did not present a PVC and was not verified by the BVAS device",
          "Everything was normal"
        ],
        correctIndex: 2,
        explanation: "Always describe what you personally SAW and HEARD with specific times and actions. 'I observed' is always more powerful than 'I believe' or editorial conclusions.",
      },
    ],
  },

  // ─────────────────────────────────────────────────
  // MODULE 5 — SAFETY, NEUTRALITY & LEGAL OBLIGATIONS
  // ─────────────────────────────────────────────────
  {
    id: "safety",
    title: "Safety, Neutrality & Legal Obligations",
    subtitle: "Protecting yourself, staying impartial, understanding the law, and knowing when to leave.",
    icon: "🛡️",
    color: "red",
    sections: [
      {
        id: "safe-1",
        title: "Personal Safety Comes First",
        content: [
          "Nigerian elections can be dangerous. Polling units in some areas experience violence, intimidation, and armed confrontations. Your safety is more important than any data you could collect.",
          "Before election day:",
          "• Share your assignment details (PU code, location, coordinator's number) with a trusted family member or friend",
          "• Set up a check-in schedule — text your contact at agreed times (e.g., every 3 hours)",
          "• Know the nearest safe location from your polling unit (a church, mosque, school, or police station)",
          "• Keep your phone charged and your power bank ready",
          "• Do not carry large amounts of cash — enough for transport and food only",
          "On election day:",
          "• Stay aware of your surroundings at all times",
          "• If the atmosphere becomes hostile, move to a safe distance while continuing to observe",
          "• Do not wear anything that could identify you as an observer if the situation becomes dangerous — remove your badge if necessary",
          "• If armed persons arrive, leave immediately. Do not wait to see what happens",
          "• Use the 'I Feel Unsafe' button at the first sign of danger",
          "• Your coordinator and the situation room will respond to your alert",
        ],
        callout: "If you feel unsafe, LEAVE. No data, no observation, no evidence is worth your life. Press the panic button and move to safety.",
        calloutType: "warning",
        scenario: {
          title: "Scenario: Escalating Tension",
          description: "It is 2:00 PM. Voting is still ongoing. You notice a crowd of 20-30 young men gathering 100 metres from the polling unit. Some are chanting. A few are carrying sticks. The presiding officer seems nervous. Voters in the queue are looking anxious.",
          question: "What is the correct response?",
          options: [
            "Continue observing as normal — they are not at the polling unit yet",
            "Move closer to take better photographs",
            "Alert your coordinator, note the time and description in the app, position yourself near an exit route, and be ready to leave if the crowd approaches",
            "Leave immediately and abandon the polling unit"
          ],
          correctIndex: 2,
          explanation: "Alert your coordinator immediately. Document what you see. Position yourself near an exit — do not trap yourself. Be ready to leave if the crowd approaches. Do not abandon the unit yet (voters still need observers), but do not put yourself in danger either.",
        },
      },
      {
        id: "safe-2",
        title: "Maintaining Political Neutrality",
        content: [
          "Your neutrality is your credibility. The moment you are perceived as biased, your observations lose value — and your accreditation can be revoked.",
          "Neutrality means:",
          "• You do not discuss your personal political views with anyone at the polling unit",
          "• You do not wear clothing, accessories, or colours associated with any party",
          "• You do not transport voters to or from the polling unit for any party",
          "• You do not distribute any material — even non-political material — at the polling unit",
          "• You do not accept food, drinks, money, or gifts from party agents or candidates",
          "• You do not join conversations where party supporters are discussing strategy",
          "• You do not celebrate or react visibly when results are announced",
          "• You treat all party agents and officials with equal respect and courtesy",
          "Practical neutrality tips:",
          "• Arrive before party agents so you cannot be associated with any group",
          "• Stand in a neutral position — not next to any party agent's table",
          "• If a party agent tries to recruit you or offers you anything, politely decline and note the interaction",
          "• If someone asks which party you support, say 'I am an independent observer and I do not support any party'",
        ],
        callout: "Do not accept food, drinks, money, or gifts from anyone at the polling unit. Even a bottle of water can be used to claim you were 'bought.'",
        calloutType: "warning",
      },
      {
        id: "safe-3",
        title: "Legal Framework — What the Law Says",
        content: [
          "Understanding the legal framework protects you and strengthens your credibility. Key provisions from the Electoral Act 2022:",
          "Section 73 — Accredited observers may be present at polling units and collation centres. They have the right to observe the entire process.",
          "Section 127 — Offences related to election bribery, undue influence, and impersonation. Vote buying is a criminal offence punishable by imprisonment.",
          "Section 145 — Penalty for disrupting election proceedings. Anyone who disrupts voting, counting, or collation commits an offence.",
          "Section 147 — Penalty for failing to perform duty. Presiding officers who fail to follow proper procedures can be prosecuted.",
          "INEC Guidelines for Observers:",
          "• Domestic observers must be accredited by INEC through their organisation",
          "• Observer accreditation badges must be worn at all times",
          "• Observers must not interfere with the voting or counting process",
          "• Observers must vacate the polling unit when instructed by the presiding officer (but may challenge arbitrary removal)",
          "As a VoteWatch agent, you operate under our organisation's INEC accreditation. Your right to be at the polling unit flows from this accreditation. If your right to observe is denied, document the denial and report it — do not argue or resist physically.",
        ],
        callout: "If your accreditation is challenged, ask the person to identify themselves and state the reason in writing. Report the incident through the app.",
        calloutType: "legal",
      },
      {
        id: "safe-4",
        title: "When to Leave",
        content: [
          "There are specific situations where you should leave the polling unit immediately:",
          "IMMEDIATE DEPARTURE (do not wait):",
          "• Armed persons enter the polling unit area",
          "• Physical violence breaks out",
          "• A fire starts or is threatened",
          "• You receive a direct personal threat",
          "• The presiding officer orders evacuation",
          "CONDITIONAL DEPARTURE (document and decide):",
          "• The polling unit is surrounded and you cannot leave safely — shelter in place and use the panic button",
          "• Voting is cancelled by INEC — document the reason and stay if safe, leave if not",
          "• You are the only person at the PU and the situation is deteriorating — document what you can and leave",
          "LEAVING PROTOCOL:",
          "1. Use the 'I Feel Unsafe' button if leaving due to danger",
          "2. Take your phone with you — it contains your evidence",
          "3. Move to the nearest safe location",
          "4. Contact your coordinator by phone call (not just SMS)",
          "5. File an incident report as soon as you are safe",
          "6. Do not return to the polling unit unless your coordinator confirms it is safe",
          "Remember: you can always be redeployed to another polling unit. Your data from the morning is already submitted. Do not risk your safety to collect a few more hours of observation.",
        ],
        callout: "If violence breaks out, leave immediately. Your GPS track will prove you were there. Your earlier data is already submitted. Do not stay to be a hero.",
        calloutType: "warning",
        scenario: {
          title: "Scenario: Order to Leave",
          description: "At 4:00 PM, during counting, the presiding officer tells you that you must leave because 'the count is confidential.' A party agent backs up this demand. You have not yet photographed the final Form EC8A.",
          question: "What should you do?",
          options: [
            "Leave immediately — the presiding officer has authority",
            "Refuse to leave and continue observing",
            "Ask for the reason in writing, note the demand in the app, try to photograph the Form EC8A if possible, then leave while documenting the denial of access",
            "Call the police"
          ],
          correctIndex: 2,
          explanation: "You have the right to observe the count. Ask for the reason in writing (creates a record), document the denial, try to photograph the Form EC8A, and leave while reporting the incident. The presiding officer does not have unlimited authority to exclude accredited observers.",
        },
      },
      {
        id: "safe-5",
        title: "Mental Health and Aftercare",
        content: [
          "Election day can be emotionally taxing. You may witness intimidation, violence, or fraud. These experiences can affect your mental health.",
          "After election day:",
          "• Take time to decompress. Do not immediately debrief on social media",
          "• Talk to someone you trust about what you experienced",
          "• If you witnessed traumatic events, contact your coordinator for support",
          "• VoteWatch provides access to counselling services for agents who need them",
          "• Submit any remaining reports or evidence within 24 hours — after that, details fade",
          "Remember: you did important work. Regardless of what you witnessed, your presence at the polling unit strengthened the democratic process. Your data gave millions of people access to information they would not otherwise have had.",
          "If you feel overwhelmed, anxious, or distressed in the days after election day, reach out. You are not alone.",
        ],
        callout: "If you need someone to talk to after election day, contact your coordinator. VoteWatch provides free counselling for all agents.",
        calloutType: "info",
      },
    ],
    minQuizScore: 4,
    quiz: [
      {
        id: "safe-q1",
        question: "What is the most important rule on election day?",
        options: [
          "Stay at the polling unit no matter what",
          "Collect as much evidence as possible",
          "Your safety comes first — leave if you feel physically threatened",
          "Follow the presiding officer's instructions at all times"
        ],
        correctIndex: 2,
        explanation: "Your safety is the top priority. No data, evidence, or observation is worth your life. If you feel threatened, press the panic button and leave.",
      },
      {
        id: "safe-q2",
        question: "A party agent offers you ₦2,000 and a meal 'for your trouble.' What should you do?",
        options: [
          "Accept it — it is just a kind gesture",
          "Accept the meal but not the money",
          "Politely decline and note the interaction in your observation report",
          "Report the agent to the police immediately"
        ],
        correctIndex: 2,
        explanation: "Never accept food, money, or gifts from anyone at the polling unit. Even a meal can be used to claim you were compromised. Politely decline and note the interaction.",
      },
      {
        id: "safe-q3",
        question: "Armed men arrive at the polling unit during counting. What is your first action?",
        options: [
          "Stand your ground and keep observing",
          "Press the 'I Feel Unsafe' button and leave immediately",
          "Confront the armed men",
          "Hide and wait for them to leave"
        ],
        correctIndex: 1,
        explanation: "Armed persons are an immediate danger. Press the panic button to alert your coordinator and situation room, then leave immediately. Do not confront armed individuals.",
      },
      {
        id: "safe-q4",
        question: "The presiding officer tells you to leave during counting. What should you do?",
        options: [
          "Leave without question",
          "Refuse and continue observing",
          "Ask for the reason in writing, document the denial, try to photograph the Form EC8A, then leave while reporting the incident",
          "Call the police"
        ],
        correctIndex: 2,
        explanation: "Ask for the reason in writing (this creates a record). Document the denial in the app. Try to photograph the Form EC8A if possible before leaving. Report the incident.",
      },
      {
        id: "safe-q5",
        question: "After election day, you feel anxious and have trouble sleeping. What should you do?",
        options: [
          "Ignore it — it will go away on its own",
          "Post about your experience on social media to feel better",
          "Contact your coordinator for support — VoteWatch provides free counselling",
          "Never volunteer again"
        ],
        correctIndex: 2,
        explanation: "Election day can be traumatic. Contact your coordinator for support. VoteWatch provides free counselling services for agents. You are not alone.",
      },
    ],
  },
];
