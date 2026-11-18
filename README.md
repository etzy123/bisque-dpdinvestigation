# DPD-onderzoek-starter

Start een DPD-onderzoek met één klik in Help Scout.

1. Je checkt de tracking van het pakket (vaak ligt het nog bij een ParcelShop of is het onderweg).
2. In het gesprek kies je de handmatige workflow, bijvoorbeeld **DPD onderzoek: niet ontvangen**. Die zet de tag `dpd-niet-ontvangen`.
3. Help Scout stuurt een webhook naar deze service op Railway.
4. De service zoekt de order in Shopify, pakt pakketnummer, verzenddatum, artikelen en waarde, maakt een orderoverzicht (PDF), neemt de foto's van de klant mee en mailt alles vanaf support@bisquegolf.com naar customerservice@dpd.nl. Onderwerp = pakketnummer, net als nu, dus de DPD-onderzoeken-tracker herkent de thread.
5. In Help Scout komt een notitie met wat er verstuurd is. Tags worden: `dpd-onderzoek-gestart`, `dpd ticket`, `waiting on dpd`. Status gaat naar Pending.

DPD vraagt bij elk onderzoek om (1) inhoud en waarde, (2) factuur of pakbon, (3) omschrijving van de verpakking. Die zitten er nu meteen in, zodat DPD niet eerst terugmailt.

## Tags (scenario's)

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

### 3. Gmail (support@bisquegolf.com)
Gebruik dezelfde Google OAuth-client als de tracker, maar maak een refresh token met de scope `gmail.send`:

```
GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... npm run gmail-token
```

Log in als support@bisquegolf.com. Is de OAuth-client van het type "Web application", voeg dan eerst `http://localhost:5555/callback` toe als redirect URI.

### 4. Help Scout API-app
Profiel (rechtsboven) > **My Apps** > **Create My App**. Redirect URL mag de Railway-URL zijn. App ID en App Secret in `HELPSCOUT_APP_ID` en `HELPSCOUT_APP_SECRET`.

### 5. Help Scout webhook
**Manage > Apps > Webhooks**:
- Callback URL: `https://<jouw-railway-url>/helpscout/webhook`
- Secret Key: hetzelfde als `HELPSCOUT_WEBHOOK_SECRET`
- Events: **Conversation > Tags Updated**
- Mailbox: support

### 6. Help Scout handmatige workflows
**Manage > Workflows > New Workflow > Manual**, vier keer:

| Naam | Actie |
|---|---|
| DPD onderzoek: niet ontvangen | Add Tag `dpd-niet-ontvangen` |
| DPD onderzoek: incompleet / geopend | Add Tag `dpd-incompleet` |
| DPD onderzoek: beschadigd | Add Tag `dpd-beschadigd` |
| DPD onderzoek: retour niet aangekomen | Add Tag `dpd-retour` |

Optioneel kun je per workflow een tweede actie **Reply to the Customer** toevoegen met het klantbericht uit de Notion-SOP.

## Testen

- `npm test` draait de tests met nepdata.
- `GET /preview/<gesprek-id>?tag=dpd-niet-ontvangen` (Basic Auth, wachtwoord = `ADMIN_PASSWORD`) laat de mail zien die verstuurd zou worden, zonder te versturen. Het gesprek-id staat in de Help Scout-URL.
- `GET /health` geeft `{ ok: true }`.

Daarna `DRY_RUN=false` zetten.
