import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記 — Marquee Tails",
};

export default function TokushohoPage() {
  return (
    <>
      {/* TEMPLATE — 公開前に弁護士レビュー必須。特に特商法の実開示情報と英語圏消費者法の適合性。 */}
      <h1>特定商取引法に基づく表記</h1>
      <p className="text-xs">
        Legal notice for Japanese Commercial Transactions Act (Tokushoho) —
        required disclosure for mail-order sales under Japanese law.
      </p>

      <table>
        <tbody>
          <tr>
            <th>販売事業者名</th>
            <td>Marquee Tails</td>
          </tr>
          <tr>
            <th>運営統括責任者</th>
            <td>
              請求があったら遅滞なく開示します
              <br />
              特定商取引に関する法律施行規則第10条第1項に基づき、ご請求があった場合は遅滞なく電子メールにて開示いたします。下記メールアドレスへご請求ください。
            </td>
          </tr>
          <tr>
            <th>所在地</th>
            <td>
              請求があったら遅滞なく開示します
              <br />
              上記同様、ご請求があった場合に遅滞なく開示いたします。お問い合わせは原則としてメールにて承ります。
            </td>
          </tr>
          <tr>
            <th>電話番号</th>
            <td>
              請求があったら遅滞なく開示します
              <br />
              お問い合わせは原則としてメールにて承ります。電話番号の開示が必要な場合は、下記メールアドレスへご請求ください。
            </td>
          </tr>
          <tr>
            <th>メールアドレス</th>
            <td>support@marqueetails.com</td>
          </tr>
          <tr>
            <th>販売価格</th>
            <td>
              各商品ページに表示（Digital Premiere $75 / Feature Film $129 /
              Collector&rsquo;s Edition $199）。表示価格は全て税込です。
            </td>
          </tr>
          <tr>
            <th>商品代金以外の必要料金</th>
            <td>
              送料（Feature Film・Collector&rsquo;s
              Editionの物理商品配送分）は各プラン価格に含まれており、別途ご負担いただく送料はありません。決済手数料も同様にお客様のご負担はありません。
            </td>
          </tr>
          <tr>
            <th>支払方法</th>
            <td>クレジットカード（Stripe）</td>
          </tr>
          <tr>
            <th>支払時期</th>
            <td>注文時に即時決済</td>
          </tr>
          <tr>
            <th>引渡し時期</th>
            <td>
              デジタル: 絵コンテ承認後48時間以内。物理商品: Printifyでの制作・発送後
              7〜14営業日。
            </td>
          </tr>
          <tr>
            <th>返品・キャンセル</th>
            <td>
              受注生産のため、ご注文後の顧客都合による返品・返金・キャンセルは原則お受けできません。納品物に不備がある場合は無償で再制作いたします。当方の事由により納品できない場合は全額返金いたします。詳細は
              <a href="/refund">Refund &amp; Cancellation Policy</a>
              をご覧ください。
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-10 text-xs">最終更新日: 2026年7月22日</p>
    </>
  );
}
