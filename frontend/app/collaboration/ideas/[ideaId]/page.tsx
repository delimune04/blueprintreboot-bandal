import { CollaborationView } from "../../../views/CollaborationView";
export default async function ThreadPage({params}:{params:Promise<{ideaId:string}>}){const value=await params;return <CollaborationView initialTab="ideas" ideaId={value.ideaId}/>;}
