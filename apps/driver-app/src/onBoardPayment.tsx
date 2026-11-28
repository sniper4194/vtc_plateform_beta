import { useState } from "react";
import { Modal, ScrollView, TextInput, View } from "react-native";
import { eurShort } from "./format";
import { c, font } from "./theme";
import { Btn, Card, Cond, Display } from "./ui";

import { ON_BOARD_ISSUE_LABEL, type OnBoardPayment } from "./onBoardPaymentBody";
export { ON_BOARD_ISSUE_LABEL, paymentBody, type OnBoardPayment } from "./onBoardPaymentBody";

/**
 * Fin d'une course payée à bord : la course ne se termine qu'après une réponse du chauffeur.
 * Pourquoi : un encaissement oublié est une perte pour le chauffeur et pour CliCab ; un impayé signalé part en alerte à la tour.
 */
export function OnBoardPaymentModal({ amountCents, busy, onAnswer, onClose }: { amountCents: number; busy: boolean; onAnswer: (p: OnBoardPayment) => void; onClose: () => void }) {
  const [issue, setIssue] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: c.sky }} contentContainerStyle={{ padding: 22, paddingTop: 48, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Card color={c.yel}>
          <Cond size={13}>Paiement à bord par carte</Cond>
          <Display size={46} color={c.ink} shadow={c.red}>{eurShort(amountCents)}</Display>
          <Cond size={13} color={c.ink}>Encaissez ce montant avec votre terminal avant de terminer la course.</Cond>
        </Card>
        {!issue ? (
          <>
            <Btn label={busy ? "Envoi…" : "✓ Paiement encaissé, terminer la course"} color={c.ok} text={c.cream} disabled={busy} onPress={() => onAnswer({ status: "PAID" })} />
            <Btn label="Problème de paiement" color={c.red} text={c.cream} disabled={busy} onPress={() => setIssue(true)} />
          </>
        ) : (
          <Card>
            <Cond size={13}>Que s'est-il passé ?</Cond>
            <View style={{ gap: 8, marginTop: 8 }}>
              {Object.entries(ON_BOARD_ISSUE_LABEL).map(([k, label]) => (
                <Btn key={k} label={reason === k ? `● ${label}` : label} color={reason === k ? c.yel : c.cream} onPress={() => setReason(k)} />
              ))}
            </View>
            <TextInput style={{ fontFamily: font.slab, fontSize: 16, color: c.ink, paddingVertical: 8, borderBottomWidth: 2.5, borderColor: c.ink, marginTop: 12 }}
              value={note} onChangeText={setNote} placeholder="Précision pour la tour (facultatif)" placeholderTextColor="#9a9ab0" multiline maxLength={300} />
            <Cond size={12} color={c.muted} style={{ marginTop: 8 }}>La course sera terminée et la tour de contrôle prévenue : elle s'occupe de la suite.</Cond>
            <View style={{ gap: 8, marginTop: 12 }}>
              <Btn label={busy ? "Envoi…" : "Signaler et terminer la course"} color={c.red} text={c.cream} disabled={busy || !reason} onPress={() => reason && onAnswer({ status: "ISSUE", reason, note })} />
              <Btn label="Retour" onPress={() => { setIssue(false); setReason(null); }} disabled={busy} />
            </View>
          </Card>
        )}
        <Btn label="Annuler (la course reste en cours)" onPress={onClose} disabled={busy} />
      </ScrollView>
    </Modal>
  );
}
