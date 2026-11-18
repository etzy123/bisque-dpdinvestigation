# DPD-onderzoek-starter

Start een DPD-onderzoek met één klik in Help Scout.

1. Je checkt de tracking van het pakket (vaak ligt het nog bij een ParcelShop of is het onderweg).
2. In het gesprek kies je de handmatige workflow **DPD onderzoek**. Die zet de tag `dpd-onderzoek-start`. Claude leest het gesprek en bepaalt het soort onderzoek (niet ontvangen, incompleet, beschadigd of retour). Is het niet duidelijk, dan wordt er niets verstuurd en krijg je een notitie.
3. Help Scout stuurt een webhook naar deze service op Railway.
4. De service zoekt de order in Shopify, pakt pakketnummer, verzenddatum, artikelen en waarde, maakt een orderoverzicht (PDF) en neemt de foto's van de klant mee.
5. Hij maakt in Help Scout een **nieuw gesprek** met customerservice@dpd.nl (onderwerp = pakketnummer) en verstuurt daarin de mail met bijlagen vanaf support@. Antwoorden van DPD (casenummer, updates, claim) komen in dat gesprek binnen. Tags op dat gesprek: `dpd-onderzoek`, `waiting on dpd`. Bovenaan staat een notitie met een link naar het klantgesprek.
6. In het klantgesprek komt een notitie met een link naar het DPD-gesprek. Tags worden: `dpd-onderzoek-gestart`, `dpd ticket`, `waiting on dpd`. Beide gesprekken gaan op Closed (in te stellen met `CUSTOMER_STATUS` en `DPD_CONVERSATION_STATUS`). Een antwoord van DPD of de klant opent het gesprek vanzelf weer.

### Claude
Met `ANTHROPIC_API_KEY` ingevuld doet Claude twee dingen per onderzoek:
- een korte toelichting voor DPD op basis van het bericht van de klant (wat ontbreekt, schade, wat de tracking zei). Ordergegevens, waarde en bijlagen blijven uit Shopify komen, die schrijft Claude niet;
- een conceptantwoord aan de klant, in de taal van de klant, als **draft** in het klantgesprek. Het belooft alleen dat het onderzoek loopt (5 tot 10 werkdagen), geen terugbetaling of vervanging. Jij leest het na en klikt Send.

Als Claude niet werkt, gaat de mail aan DPD gewoon zonder toelichting en staat dat in de notitie. Kosten: enkele centen per onderzoek. In `/preview/<id>` zie je ook het conceptantwoord.

Help Scout accepteert bijlagen tot ongeveer 10 MB per bestand. Grotere foto's worden overgeslagen en in de notitie genoemd.

DPD vraagt bij elk onderzoek om (1) inhoud en waarde, (2) factuur of pakbon, (3) omschrijving van de verpakking. Die zitten er nu meteen in, zodat DPD niet eerst terugmailt.

## Tags (scenario's)

Standaard: `dpd-onderzoek-start` (Claude kiest het scenario). Weet je het zelf al, of twijfelt Claude, gebruik dan een specifieke tag; die wint altijd:

| Tag | Wanneer |
|---|---|
| `dpd-niet-ontvangen` | Klant heeft het pakket niet ontvangen |
| `dpd-incompleet` | Pakket geopend, leeg of er ontbreekt iets |
| `dpd-beschadigd` | Pakket of inhoud beschadigd |
| `dpd-retour` | Retourzending van klant komt niet bij ons aan |

## Notities die de service leest

Zet vóór het taggen een interne notitie in het gesprek als je iets wilt sturen:

```
DPD order: #38084
DPD pakket: 05165897255876
DPD ontbreekt: Malbon polo maat M, navy
DPD opmerking: klant heeft de doos bewaard
```

`DPD pakket:` is verplicht bij retouren (retourlabels staan niet in Shopify) en wint altijd van wat er in Shopify staat (Shopify had bij #37308 een verkeerd nummer).

## Wanneer verstuurt hij níet

Bij twijfel stuurt de service niets. Hij zet dan een notitie met de reden en de tag `dpd-onderzoek-fout`, bijvoorbeeld:
- geen order gevonden of meerdere mogelijke orders;
- het pakketnummer uit het gesprek hoort niet bij de order;
- de order heeft meerdere pakketten;
- het pakket ging niet met DPD.

Notitie toevoegen en de workflow opnieuw draaien is genoeg.

## Installatie

### 1. Railway
Nieuwe service vanuit deze map (GitHub-repo of `railway up`). Start-commando: `npm start`. Vul de variabelen uit `.env.example` in. Laat `DRY_RUN=true` staan tot je tevreden bent: dan gaan de mails naar `DRY_RUN_TO` en krijgt het gesprek de tag `dpd-onderzoek-test`.

### 2. Shopify
Gebruik een app uit het Dev Dashboard die in dezelfde Shopify-organisatie zit als de winkel en daar geïnstalleerd is (de app van het garantieportaal kan ook, als die `read_orders` heeft). Nodig:
- scope `read_orders`;
- toegang tot beschermde klantgegevens (naam en adres), anders blijft de ontvanger leeg.

Zet Client ID en Client secret in `SHOPIFY_CLIENT_ID` en `SHOPIFY_CLIENT_SECRET`. De service haalt zelf elke 24 uur een nieuwe token (client credentials grant), dus geen statische token die verloopt.

### 3. Help Scout API-app
Profiel (rechtsboven) > **My Apps** > **Create My App**. Redirect URL mag de Railway-URL zijn. App ID en App Secret in `HELPSCOUT_APP_ID` en `HELPSCOUT_APP_SECRET`. De mails aan DPD gaan uit op naam van de gebruiker die de app maakt, dus maak hem aan met jouw account (of een account met toegang tot de support-mailbox).

### 4. Help Scout webhook
**Manage > Apps > Webhooks**:
- Callback URL: `https://<jouw-railway-url>/helpscout/webhook`
- Secret Key: hetzelfde als `HELPSCOUT_WEBHOOK_SECRET`
- Events: **Conversation > Tags Updated**
- Mailbox: support

### 5. Help Scout handmatige workflows
**Manage > Workflows > New Workflow > Manual**:

| Naam | Actie |
|---|---|
| DPD onderzoek | Add Tag `dpd-onderzoek-start` |

Optioneel, om het scenario zelf te kiezen (bijvoorbeeld als Claude twijfelt):

| Naam | Actie |
|---|---|
| DPD: niet ontvangen | Add Tag `dpd-niet-ontvangen` |
| DPD: incompleet / geopend | Add Tag `dpd-incompleet` |
| DPD: beschadigd | Add Tag `dpd-beschadigd` |
| DPD: retour niet aangekomen | Add Tag `dpd-retour` |

Optioneel kun je per workflow een tweede actie **Reply to the Customer** toevoegen met het klantbericht uit de Notion-SOP.

## Testen

- `npm test` draait de tests met nepdata.
- `GET /preview/<gesprek-id>?tag=dpd-onderzoek-start` (of een specifieke tag) (Basic Auth, wachtwoord = `ADMIN_PASSWORD`) laat de mail zien die verstuurd zou worden, zonder te versturen. Het gesprek-id staat in de Help Scout-URL.
- `GET /health` geeft `{ ok: true }`.

Met `DRY_RUN=true` gaat de mail naar `DRY_RUN_TO` (ook als nieuw Help Scout-gesprek, met tag `dpd-onderzoek-test`). Controleer daarin:
- staan de bijlagen erbij;
- staat de handtekening er niet dubbel in (dan `INCLUDE_SIGNATURE=false`);
- komt jouw antwoord op die testmail terug in hetzelfde Help Scout-gesprek.

Daarna `DRY_RUN=false` zetten.
