import { CollaborationView } from "../../../views/CollaborationView";
export default async function ThreadPage({params}:{params:Promise<{taskId:string}>}){const value=await params;return <CollaborationView initialTab="tasks" taskId={value.taskId}/>;}
