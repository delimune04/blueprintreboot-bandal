/** Authored teaching examples, never represented as published research.
 * Full text matches the bundled two-page PDFs exactly. */
export const DEMO_PAPERS = [
  {
    "paper_id": "demo-ccs",
    "title": "[Demo] Screening a CO2 Storage Site",
    "authors": "BANDAL Demo Workspace",
    "year": "2026",
    "journal": "Authored demonstration material · not a published paper",
    "doi": "",
    "abstract": "This authored sample compares three fictional carbon dioxide storage candidates using an intentionally simple weighted score. Capacity, seal integrity and injectivity receive weights of 0.4, 0.4 and 0.2. Site B leads under the stated assumptions, but the ranking alone cannot establish geological feasibility. The example supports reading, annotation and comparison inside a research workspace.",
    "keywords": "CCS, reservoir, monitoring, demo",
    "tags": [
      "ccs",
      "reservoir"
    ],
    "status": "reading",
    "priority": "high",
    "fullText": "BluePrint / KU-AI demonstration Authored sample - not a real publication\n[Demo] Screening a CO2 Storage Site\nBANDAL Demo Workspace | Sample research note | 2026\nStatus: authored sample, not a real publication. Sites A, B and C are fictional. Numeric data were\ninvented for a reproducible product demonstration.\nAbstract\nThis authored sample compares three fictional carbon dioxide storage candidates using an\nintentionally simple weighted score. Capacity, seal integrity and injectivity receive weights of\n0.4, 0.4 and 0.2. Site B leads under the stated assumptions, but the ranking alone cannot\nestablish geological feasibility. The example supports reading, annotation and comparison\ninside a research workspace.\n1. Screening method\nEach criterion is a synthetic score from 0 to 100. The screening score is S = 0.4C + 0.4L +\n0.2I, where C is capacity, L is seal integrity and I is injectivity. These scores are teaching\ninputs; no field survey or reservoir model was performed.\nSynthetic weighted score / 100\n100\n81.8\n78.2\n73.6\n75\n50\n25\n0\nSite A Site B Site C\nFigure 1. Invented screening scores. All values are synthetic and follow the stated arithmetic exactly.\nFictional demonstration material. All measurements and sites are synthetic. 1 / 2\n\nBluePrint / KU-AI demonstration Authored sample - not a real publication\n2. Reproducible synthetic inputs\nFictional site Capacity C Seal L Injectivity I Score S\nSite A 72 91 65 78.2\nSite B 86 74 89 81.8\nSite C 61 88 70 73.6\nWorked example for Site B: 0.4 x 86 + 0.4 x 74 + 0.2 x 89 = 34.4 + 29.6 + 17.8 = 81.8.\nScores are unitless and synthetic. They are not storage-capacity estimates.\n3. Interpretation and limits\nSite A has the strongest fictional seal score. Site B benefits from larger fictional capacity and\ninjectivity scores. Any decision based on this ranking remains sensitive to the weights, score\ndefinitions and missing evidence. A realistic assessment would separately examine pressure,\ncontainment, groundwater, uncertainty and site-specific conditions.\n4. Suggested reading notes\nQuestion: Would Site A rank first if containment were weighted more strongly?\nClaim to annotate: a screening rank is not a feasibility finding.\nFollow-up: record which additional evidence could reverse the ranking.\nProvenance\nCreated specifically as a sample PDF for the BANDAL-hosted BluePrint demonstration. No DOI,\njournal, external authorship or real research finding is claimed. Reuse is intended for product\ntesting and presentations.\nReader exercise: select the weighted-score formula or the Site B worked example, then save a\nnote in the demo workspace.\nFictional demonstration material. All measurements and sites are synthetic. 2 / 2",
    "note": "## One-line Summary\nA screening table should show evidence quality alongside capacity estimates.\n\n## Questions\n- Which uncertainty would most change a site ranking?\n- Can a monitoring plan test the chosen geological model?\n",
    "block": {
      "block_type": "question",
      "title": "What changes the site ranking?",
      "text": "Compare uncertainty in connected pore volume with the confidence in caprock continuity. This is an authored exercise, not a research finding.",
      "page": "1",
      "tags": [
        "ccs"
      ]
    }
  },
  {
    "paper_id": "demo-muon",
    "title": "[Demo] Muon Tomography: From Counts to Density",
    "authors": "BANDAL Demo Workspace",
    "year": "2026",
    "journal": "Authored demonstration material · not a published paper",
    "doi": "",
    "abstract": "This fictional example uses five viewing bins to illustrate a transmission-count comparison. Every reference bin contains 1,000 invented events; corresponding target counts range from 650 to 930. The central bin has the lowest synthetic transmission ratio. The note demonstrates how a reader can connect numerical evidence to an interpretation without presenting invented measurements as scientific results.",
    "keywords": "muon, tomography, detector, demo",
    "tags": [
      "muon",
      "tomography"
    ],
    "status": "unread",
    "priority": "normal",
    "fullText": "BluePrint / KU-AI demonstration Authored sample - not a real publication\n[Demo] Muon Tomography: From\nCounts to Density\nBANDAL Demo Workspace | Sample research note | 2026\nStatus: authored sample, not a real publication. All particle counts, viewing bins and transmission\nratios below are synthetic. No detector was operated.\nAbstract\nThis fictional example uses five viewing bins to illustrate a transmission-count comparison.\nEvery reference bin contains 1,000 invented events; corresponding target counts range from\n650 to 930. The central bin has the lowest synthetic transmission ratio. The note\ndemonstrates how a reader can connect numerical evidence to an interpretation without\npresenting invented measurements as scientific results.\n1. Counting model\nFor each viewing bin, T = N_target / N_reference. Reference and target counts are assumed to\nhave equal exposure for this demonstration. Lower transmission motivates a density question,\nbut this sample does not solve an inverse problem or infer a physical density.\nSynthetic transmission ratio T\n1 0.92 0.93\n0.81 0.81\n0.75\n0.65\n0.5\n0.25\n0\nBin 1 Bin 2 Bin 3 Bin 4 Bin 5\nFigure 1. Transmission ratios from invented counts. Viewing bins are labels; no angle or physical\ndistance is assigned.\nFictional demonstration material. All measurements and sites are synthetic. 1 / 2\n\nBluePrint / KU-AI demonstration Authored sample - not a real publication\n2. Synthetic count table\nViewing bin Reference count Target count Transmission T\n1 1,000 920 0.92\n2 1,000 810 0.81\n3 1,000 650 0.65\n4 1,000 810 0.81\n5 1,000 930 0.93\nWorked example for Bin 3: T = 650 / 1,000 = 0.65. The deficit relative to the invented\nreference is 350 events, or 35%. Those values are arithmetic outputs of synthetic inputs, not\nan observed anomaly.\n3. Interpretation and limits\nThe central-bin deficit is a useful annotation target. Equal exposure is an explicit simplifying\nassumption. Detector acceptance, direction-dependent flux, background and counting\nuncertainty would all need treatment in a real experiment. Different geometric models could\nexplain similar transmission patterns.\n4. Suggested reading notes\nQuestion: How would unequal exposure change the transmission calculation?\nClaim to annotate: a count deficit alone does not determine density.\nConnection: link this sample to the seismic uncertainty note to compare two indirect\nmeasurements.\nProvenance\nCreated specifically as a sample PDF for the BANDAL-hosted BluePrint demonstration. The\ndataset and document are authored demonstration material. No journal article, detector result\nor external source is represented.\nReader exercise: highlight the Bin 3 calculation and record which assumptions would be required\nbefore interpreting a real target.\nFictional demonstration material. All measurements and sites are synthetic. 2 / 2",
    "note": "## Methods\n- Keep detector calibration separate from reconstruction assumptions.\n\n## Ideas\n- Link a validation experiment to the detector Project.\n",
    "block": {
      "block_type": "method",
      "title": "Separate acceptance from attenuation",
      "text": "An open-sky reference and an explicit acceptance model make the reasoning traceable. This sample does not provide measured count data.",
      "page": "1",
      "tags": [
        "muon",
        "tomography"
      ]
    }
  },
  {
    "paper_id": "demo-seismic",
    "title": "[Demo] Seismic Evidence for a Subsurface Model",
    "authors": "BANDAL Demo Workspace",
    "year": "2026",
    "journal": "Authored demonstration material · not a published paper",
    "doi": "",
    "abstract": "This authored sample converts an invented two-way reflection time of 0.90 seconds to depth under three constant-velocity assumptions. Velocities of 2,200, 2,400 and 2,600 meters per second produce depths of 990, 1,080 and 1,170 meters. The exercise isolates model sensitivity and encourages readers to preserve assumptions alongside a reported estimate.",
    "keywords": "seismic, inversion, uncertainty, demo",
    "tags": [
      "seismic",
      "reservoir"
    ],
    "status": "finished",
    "priority": "normal",
    "fullText": "BluePrint / KU-AI demonstration Authored sample - not a real publication\n[Demo] Seismic Evidence for a\nSubsurface Model\nBANDAL Demo Workspace | Sample research note | 2026\nStatus: authored sample, not a real publication. Reflection times and velocities are invented. This\nis an arithmetic illustration, not an interpretation of real seismic data.\nAbstract\nThis authored sample converts an invented two-way reflection time of 0.90 seconds to depth\nunder three constant-velocity assumptions. Velocities of 2,200, 2,400 and 2,600 meters per\nsecond produce depths of 990, 1,080 and 1,170 meters. The exercise isolates model\nsensitivity and encourages readers to preserve assumptions alongside a reported estimate.\n1. Constant-velocity example\nFor this simplified vertical-ray example, z = vt / 2. The factor of two accounts for the stated\ntwo-way time. We fix t = 0.90 seconds and vary only v. No dipping reflector, lateral variation\nor processing uncertainty is modeled.\nSynthetic depth z (m); labels are velocity v (m/s)\n1170\n1200\n1080\n990\n900\n600\n300\n0\n2,200 2,400 2,600\nFigure 1. Invented depth estimates under three assumed velocities. The chart is a sensitivity exercise\nusing synthetic values.\nFictional demonstration material. All measurements and sites are synthetic. 1 / 2\n\nBluePrint / KU-AI demonstration Authored sample - not a real publication\n2. Synthetic time-to-depth inputs\nAssumed velocity Two-way time Depth z Offset from middle\n2,200 m/s 0.90 s 990 m -90 m\n2,400 m/s 0.90 s 1,080 m 0 m\n2,600 m/s 0.90 s 1,170 m +90 m\nWorked middle case: z = 2,400 x 0.90 / 2 = 1,080 meters. The three assumed velocities\nproduce a 180-meter spread. The +/-90-meter range is a synthetic scenario range around the\nmiddle case, not a confidence interval.\n3. Sensitivity and interpretation\nAt fixed time, the depth change is proportional to the velocity change: dz/dv = t/2 = 0.45\nseconds. Raising the assumed velocity by 200 meters per second raises the estimated depth\nby 90 meters in this example. This statement follows the simplified model; it does not quantify\nreal subsurface uncertainty.\n4. Suggested reading notes\nQuestion: Which velocity evidence would narrow the scenario range?\nClaim to annotate: a scenario range is not a confidence interval.\nConnection: compare model assumptions here with scoring assumptions in the CO2 storage\nscreening note.\nProvenance\nCreated specifically as a sample PDF for the BANDAL-hosted BluePrint demonstration. All data\nare synthetic and all calculations are transparent. No survey, external publication, DOI or\nscientific validation is claimed.\nReader exercise: select the time-to-depth formula and save a note that keeps the time, velocity\nassumption and resulting depth together.\nFictional demonstration material. All measurements and sites are synthetic. 2 / 2",
    "note": "## One-line Summary\nSeparate an observation from the model used to interpret it.\n\n## Limitations\n- Multiple subsurface models may explain a sparse observation set.\n",
    "block": {
      "block_type": "limitation",
      "title": "Model non-uniqueness",
      "text": "A preferred velocity model is a hypothesis until independently constrained. No real inversion results are claimed in this authored example.",
      "page": "1",
      "tags": [
        "seismic"
      ]
    }
  }
];

export const DEMO_TAGS = [
  {
    "canonical_key": "ccs",
    "label": "CCS",
    "category": "field",
    "aliases": [
      "carbon storage"
    ],
    "description": "Carbon storage research exercises.",
    "status": "active",
    "suggestion_strength": 1
  },
  {
    "canonical_key": "reservoir",
    "label": "Reservoir",
    "category": "concept",
    "aliases": [],
    "description": "Reservoir characterization and uncertainty.",
    "status": "active",
    "suggestion_strength": 1
  },
  {
    "canonical_key": "muon",
    "label": "Muon",
    "category": "method",
    "aliases": [
      "muography"
    ],
    "description": "Muon observations and detector questions.",
    "status": "active",
    "suggestion_strength": 1
  },
  {
    "canonical_key": "tomography",
    "label": "Tomography",
    "category": "method",
    "aliases": [],
    "description": "Reconstruction and imaging methods.",
    "status": "active",
    "suggestion_strength": 1
  },
  {
    "canonical_key": "seismic",
    "label": "Seismic",
    "category": "method",
    "aliases": [
      "seismology"
    ],
    "description": "Seismic observations and interpretation.",
    "status": "active",
    "suggestion_strength": 1
  }
];
