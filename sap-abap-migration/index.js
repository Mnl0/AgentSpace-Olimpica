const functions = require('@google-cloud/functions-framework');
const { VertexAI } = require('@google-cloud/vertexai');
const dotenv = require('dotenv');
dotenv.config();

const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION_PRJ = process.env.LOCATION_PRJ || 'us-central1';
const MODEL_NAME = process.env.MODEL_NAME || 'gemini-2.0-flash-001';

const AGENT_INSTRUCTION = `
	As an expert ABAP developer specializing in S/4HANA migrations, your task is to analyze the provided ABAP code from an older SAP ECC version and provide a complete, refactored version that is fully compatible with SAP S/4HANA.

	Your analysis and refactoring should adhere to the following principles:

	1. S/4HANA Compatibility and Best Practices:
			* Syntax and Statement Obsolescence: Identify and replace any obsolete ABAP statements (e.g., \`SELECT ... FOR ALL ENTRIES\` considerations for performance, implicit work area declarations, \`FIELD-SYMBOLS\` usage for internal tables).
			* Data Model Changes: Account for simplified data models (e.g., MATDOC instead of MKPF/MSEG, ACDOCA for financial documents). Replace direct table access with CDS views where appropriate and efficient.
			* Performance Optimization: Suggest and implement performance improvements relevant to S/4HANA (e.g., using \`NEW\` syntax for internal table operations, avoiding unnecessary loops, leveraging \`FOR ... IN TABLE\`).
			* OPEN SQL Enhancements: Utilize new OPEN SQL features for improved readability and performance (e.g., \`INTO TABLE @DATA(...)\`, \`CORRESPONDING FIELDS OF\`).
			* AMDP/ABAP Managed Database Procedures: If the logic is highly data-intensive and can benefit from database pushdown, suggest and provide AMDP implementations as an alternative, explaining the rationale.
			* Simplification List Adherence: Ensure the code aligns with the S/4HANA Simplification List. Address any deprecated functionalities or transactions.

	2. CDS View Recommendation and Implementation:
			* Identify Opportunities: Analyze the existing database access patterns and determine if any of the data retrieval logic can be encapsulated and optimized using Core Data Services (CDS) views. Look for:
					* Frequent joins across multiple tables.
					* Complex \`SELECT\` statements with aggregations or calculations.
					* Data exposure requirements for Fiori applications or external consumption.
			* Provide CDS Code: If a CDS view is recommended, provide the complete DDL source code for the CDS view in a separated block, including:
					* Appropriate annotations (e.g., \`@AbapCatalog.sqlViewName\`, \`@OData.publish\`).
					* Associations and joins.
					* Calculated fields or aggregations.
					* Input parameters if necessary.
			* Refactor ABAP to Use CDS: Modify the original ABAP code to consume the newly created CDS view instead of direct table access.

	3. Output Format:
			* Refactored ABAP Code: Provide the complete, refactored ABAP code, highlighting the changes made and adding comments to explain significant modifications.
			* CDS View Code (if recommended): Present the complete DDL source code for the recommended CDS view.
			* Explanation and Rationale: For each significant change or recommendation (especially for CDS views or AMDPs), provide a concise explanation of *why* the change was made and the benefits it brings in the S/4HANA context (e.g., performance, simplification, adherence to best practices).

	4. Input Clarification: The ABAP code to be analyzed will be provided directly as the input query to you. Your task is to process that ABAP code based on the instructions above.
	---
	ABAP Code to analyze:

`;

let vertex_ai;

if (!PROJECT_ID && !LOCATION_PRJ && !MODEL_NAME) {
	console.error('Please set the environment variables: GOOGLE_CLOUD_PROJECT, LOCATION_PRJ, MODEL_NAME');
	exit(1);
} else {
	try {
		vertex_ai = new VertexAI({
			projectId: PROJECT_ID,
			location: LOCATION_PRJ,
		})
	} catch (error) {
		console.error('Error initializing Vertex AI:', error);
		exit(1);
	}
}

console.log(
	`
	Environment Variables:
	GOOGLE_CLOUD_PROJECT: ${PROJECT_ID}
	LOCATION_PRJ: ${LOCATION_PRJ}
	MODEL_NAME: ${MODEL_NAME}	
	`
);

functions.http('main', async (req, res) => {
	res.set('Access-Control-Allow-Origin', '*');
	res.set('Access-Control-Allow-Methods', 'POST');
	res.set('Access-Control-Allow-Headers', 'Content-Type');
	res.set('Access-Control-Max-Age', '3600');

	if(req.method === 'OPTIONS') {
		res.status(204).send('');
		return;
	}

	if(!PROJECT_ID || !LOCATION_PRJ || !MODEL_NAME) {
		res.status(500).send('Environment variables not set correctly.');
		return;
	}

	if(req.method !== 'POST') {
		res.status(405).send('Method Not Allowed');
		return;
	}

	if(!req.body || !req.body.abapCode) {
		res.status(400).send('Bad Request: Missing abapCode in request body');
		return;
	}

	const inputAbapCode = req.body.abapCode;

	if(typeof inputAbapCode !== 'string' || inputAbapCode.trim() === '') {
		res.status(400).send('Bad Request: abapCode must be a non-empty string');
		return;
	}

	try {
		console.log('Received ABAP code for analysis:', inputAbapCode);
		const generativeModel = vertex_ai.getGenerativeModel({
			model: MODEL_NAME,
			temperature: 0.2,
		});
		const fullPrompt = AGENT_INSTRUCTION + "\n" + inputAbapCode;

		const requestPayload = {
			contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
		}
		const result = await generativeModel.generateContent(requestPayload);
		const response = result.response;
		
		if (!response || !response.candidates || response.candidates.length === 0 || !response.candidates[0].content || !response.candidates[0].content.parts || response.candidates[0].content.parts.length === 0) {
			res.status(500).send('Error: No valid response from the model');
			return;
		}
		const output = response.candidates[0].content.parts[0].text;
		res.status(200).send(output);
	}catch(error){
		res.status(500).send(`Error processing request: ${error.message}`);
	}

});
