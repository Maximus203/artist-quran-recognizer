import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** L'ancienne page « Fichiers » est devenue « Téléchargements » : les anciens liens y mènent. */
export default function Page() {
  redirect("/telechargements");
}
