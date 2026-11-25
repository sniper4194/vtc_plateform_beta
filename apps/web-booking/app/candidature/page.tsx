"use client";
import { useState } from "react";
import { emptyForm, toPayload, validate, type Form } from "../../lib/application";
import { API_URL } from "../../lib/tracking";

export default function Candidature() {
  const [f, setF] = useState<Form>(emptyForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const e = validate(f);
    setErrors(e); setServerError("");
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/apply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(toPayload(f)) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.message ?? (j?.errors ? "Certains champs sont invalides : vérifiez le formulaire." : `Erreur ${res.status}`));
      setDone(j.reference);
    } catch (err: any) { setServerError(err.message === "Failed to fetch" ? "Connexion impossible : réessayez dans un instant." : err.message); }
    finally { setBusy(false); }
  }

  if (done) return (
    <main className="wrap">
      <div className="brand">CliCab</div>
      <div className="card">
        <h1>Candidature reçue</h1>
        <p className="muted">Merci ! Référence <b>{done}</b>. Un e-mail de confirmation vous est envoyé.</p>
        <p className="muted">La suite : vérification de votre carte professionnelle et de votre permis (vous présenterez votre relevé d'information intégral), tests de français, d'anglais et mises en situation, puis un entretien. Nous répondons à chaque candidat, y compris en cas de refus.</p>
      </div>
    </main>
  );

  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="field">
      <span>{label}</span>
      <input value={f[k] as string} onChange={(e) => set(k, e.target.value as never)} aria-invalid={!!errors[k]} {...props} />
      {errors[k] && <em className="err">{errors[k]}</em>}
    </label>
  );

  return (
    <main className="wrap">
      <div className="brand">CliCab</div>
      <form className="card" onSubmit={submit} noValidate>
        <h1>Devenir chauffeur CliCab</h1>
        <p className="muted">Phase pilote, sur parrainage. Notre sélection est exigeante : carte professionnelle, permis, tests et entretien. Vous restez indépendant.</p>

        {field("code", "Code de parrainage", { placeholder: "CLI-XXXX-XXXX", autoCapitalize: "characters", autoComplete: "off" })}
        {field("firstName", "Prénom", { autoComplete: "given-name" })}
        {field("lastName", "Nom", { autoComplete: "family-name" })}
        {field("phone", "Téléphone", { type: "tel", autoComplete: "tel", placeholder: "06 12 34 56 78" })}
        {field("email", "E-mail", { type: "email", autoComplete: "email" })}
        {field("years", "Années d'expérience comme chauffeur", { inputMode: "numeric", placeholder: "ex. 5" })}

        <fieldset className="field">
          <legend>Autres plateformes (facultatif)</legend>
          <p className="small">Si vous travaillez déjà avec d'autres plateformes, indiquez leur nom et votre note. C'est déclaratif et sert de point de départ à l'entretien : cela ne décide pas seul de votre candidature.</p>
          {f.platforms.map((p, i) => (
            <div className="two" key={i}>
              <input aria-label="Plateforme" placeholder="Plateforme" value={p.name} onChange={(e) => set("platforms", f.platforms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input aria-label="Note sur 5" placeholder="Note /5" inputMode="decimal" value={p.rating} onChange={(e) => set("platforms", f.platforms.map((x, j) => (j === i ? { ...x, rating: e.target.value } : x)))} />
            </div>
          ))}
          {f.platforms.length < 4 && <button type="button" className="link" onClick={() => set("platforms", [...f.platforms, { name: "", rating: "" }])}>+ Ajouter une plateforme</button>}
          {errors.platforms && <em className="err">{errors.platforms}</em>}
        </fieldset>

        <label className="check">
          <input type="checkbox" checked={f.consent} onChange={(e) => set("consent", e.target.checked)} />
          <span>J'accepte que CliCab traite ces informations pour examiner ma candidature, et qu'elle contrôle ma carte professionnelle ainsi que mon permis (relevé d'information intégral que je présenterai : seul le résultat du contrôle est conservé). Une candidature refusée est effacée après 180 jours. Je peux demander l'effacement à tout moment : contact@clicab.fr.</span>
        </label>
        {errors.consent && <em className="err">{errors.consent}</em>}

        {serverError && <p className="err" role="alert">{serverError}</p>}
        <button className="primary" type="submit" disabled={busy}>{busy ? "Envoi…" : "Envoyer ma candidature"}</button>
      </form>
    </main>
  );
}
