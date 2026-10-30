import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** La zone Administration s'ouvre sur sa première section. */
export default function AdminIndex() {
  redirect("/gestion/moteur");
}
