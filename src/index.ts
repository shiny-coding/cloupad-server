import express from 'express';
import bodyParser from "body-parser";
import neo4j from 'neo4j-driver';

import dotenv from 'dotenv';

const morgan = require("morgan");
const helmet = require("helmet");
const { expressjwt: jwt } = require("express-jwt");
const jwksRsa = require("jwks-rsa");

const app = express();

dotenv.config();

if ( !process.env.AUTH0_DOMAIN || !process.env.AUTH0_AUDIENCE ) {
	console.log( "Exiting: need process.env.AUTH0_DOMAIN and process.env.AUTH0_AUDIENCE set" );
	process.exit();
}

app.use(morgan("dev"));
app.use(helmet());


const router = express.Router();
router.use( express.json() );

const neo4jDriver = neo4j.driver(
	process.env.NEO4J_CONNECTION_STRING ?? '',
	neo4j.auth.basic( 'neo4j', process.env.NEO4J_PASS ?? '' ),
	{ disableLosslessIntegers: true }
);

app.use( (req, res, next) => {
    res.append('Access-Control-Allow-Origin', ['*']);
    res.append('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.append('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    next();
});

app.use( bodyParser.urlencoded({ extended: false }) );
app.use( bodyParser.json() );

const checkJwt = jwt({
	secret: jwksRsa.expressJwtSecret( {
		cache: true,
		rateLimit: true,
		jwksRequestsPerMinute: 15,
		jwksUri: `https://${process.env.AUTH0_DOMAIN}/.well-known/jwks.json`,
	} ),

	audience: process.env.AUTH0_AUDIENCE,
	issuer: `https://${process.env.AUTH0_DOMAIN}/`,
	// scope: 'openid profile email read:appointments',
	algorithms: [ "RS256" ],
});

const PORT = process.env.PORT || 3001;

async function main() {

	app.listen( PORT, () => {
		console.log(`Server started at http://localhost:${PORT}`);
	} );

	function getEmailFromRequest( request: any ) {
		let userEmail = (request as any).auth.email;
		return userEmail;
	}

	app.post( "/editMany", checkJwt, async ( request, response, next ) => {
		let userEmail = getEmailFromRequest( request );

		const session = neo4jDriver.session();

		try {
			for ( let document of request.body.documents ) {
				let { isFolder } = document;
				await session.run(
					`MATCH (u:User {email: $userEmail})
					MERGE (u)-[:OWNS]->(d:Document {userEmail: $userEmail, uid: $uid, isFolder: $isFolder})
						` + ( isFolder
							? `SET d.path=$path, d.expanded=$expanded`
							: `SET d.path=$path, d.content=$content` ),
					{ ...document, userEmail },
					{ timeout: 5000 }
				);
			}

			session.close();
			response.json( { success : true } );

		} catch ( exception ) { next( exception ); } finally { session.close(); }
	});

	app.post( "/editFile", checkJwt, async ( request, response, next ) => {
		let userEmail = getEmailFromRequest( request );
		let { isFolder } = request.body as any;

		const session = neo4jDriver.session();

		try {
			await session.run(
				`MATCH (u:User {email: $userEmail})
				MERGE (u)-[:OWNS]->(d:Document {userEmail: $userEmail, uid: $uid, isFolder: $isFolder})
					` + ( isFolder
						? `SET d.path=$path, d.expanded=$expanded`
						: `SET d.path=$path, d.content=$content` ),
				{ ...request.body, userEmail },
				{ timeout: 5000 }
			);

			response.json( { success : true } );

		} catch ( exception ) { next( exception ); } finally { session.close(); }
	});

	app.get( "/deleteFile", checkJwt, async ( request, response, next ) => {
		let userEmail = getEmailFromRequest( request );
		let uid = + (request.query as any).uid;

		const session = neo4jDriver.session();

		try {
			await session.run(
				`MATCH (u:User {email: $userEmail})-[:OWNS]->(d:Document {userEmail: $userEmail, uid: $uid})
					DETACH DELETE d`,
				{ userEmail, uid },
				{ timeout: 5000 }
			);

			response.json( { success : true } );

		} catch ( exception ) { next( exception ); } finally { session.close(); }
	});

	app.post( "/updateUser", checkJwt, async ( request, response, next ) => {
		let userEmail = getEmailFromRequest( request );
		const session = neo4jDriver.session()

		try {
			await session.run(
				`MATCH (u:User {email: $userEmail})
					SET u.openedDocuments=$openedDocuments,
						u.activeDocument=$activeDocument,
						u.previewDocument=$previewDocument,
						u.exploredDocument=$exploredDocument`,
					{ ...request.body, userEmail }, { timeout: 5000 }
			);

			response.json( { success : true } );

		} catch ( exception ) { next( exception ); } finally { session.close(); }
	});

	app.get( "/getUserData", checkJwt, async ( request, response, next ) => {
		let { userEmail } = request.query as any;
		const session = neo4jDriver.session()

		try {
			let result = await session.run(
				`MERGE (u:User {email: $userEmail})
					RETURN u`, { userEmail }, { timeout: 5000 }
			);

			let userCreated = result.summary.counters.updates().nodesCreated > 0;
			const userProperties = result.records[ 0 ].get( 'u' ).properties;

			result = await session.run(
				`MATCH (u:User {email: $userEmail})-[:OWNS]->(d:Document)
					RETURN d`,
				{ userEmail },
				{ timeout: 5000 }
			);

			const documents = result.records.map(
				record => record.get( 'd' ).properties
			);

			for ( let document of documents ) delete document.userEmail;

			response.json( { documents, userCreated, ...userProperties } );

		} catch ( exception ) { next( exception ); } finally { session.close(); }
	});

	app.use( ( err:any, req:any, res:any, next:any ) => {
		res.status(500).json({ error: true, err });
	});
};

main();
