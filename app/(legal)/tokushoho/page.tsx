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
            <td>株式会社アフロ（サービス名: Marquee Tails）</td>
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
              各商品ページに表示（Preset Worlds $99、Director&rsquo;s Cut
              $249）。表示価格は全て税込です。
            </td>
          </tr>
          <tr>
            <th>商品代金以外の必要料金</th>
            <td>
              本プランはデジタル動画・デジタルポスターの提供のみで、送料は発生しません。決済手数料もお客様のご負担はありません。プリント版ポスター（$59）・ギャラリーキャンバス（$99）は納品後に追加購入いただけるオプション（アドオン）で、その決済・送料は別途発生します。
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
              動画・デジタルポスター: 絵コンテ承認後48時間以内にお届けします。
            </td>
          </tr>
          <tr>
            <th>返品・キャンセル</th>
            <td>
              受注生産のため、ご注文後の顧客都合による返品・返金・キャンセルは原則お受けできません。
              <br />
              撮影前に絵コンテ（6カットの静止画）をご確認・ご承認いただく工程があり、
              変更はこの段階でお受けします。全プランで、絵コンテの無償リロールを
              <strong>1注文につき合計2回</strong>ご利用いただけます（1シーンにつき2回ではありません）。
              <br />
              <strong>ご承認後に納品した動画の作り直しはお受けしておりません。</strong>
              お客様がご確認・ご承認いただいた絵コンテから制作するためです。
              <br />
              Director&rsquo;s Cut（$249）に限り、上記に加えて文章トリートメントの無償修正を2回まで、
              および、2回のリロールを使い切ってもなお絵コンテをご承認いただけない場合に限り、
              撮影開始前にご注文を終了して$150を返金する制度をご利用いただけます
              （企画・絵コンテ費$99は非返金）。絵コンテ承認後（撮影開始後）はこの制度の対象外です。詳細は
              <a href="/refund">Refund &amp; Cancellation Policy</a>
              をご覧ください。
            </td>
          </tr>
        </tbody>
      </table>

      <p className="mt-10 text-xs">最終更新日: 2026年8月3日</p>
    </>
  );
}
