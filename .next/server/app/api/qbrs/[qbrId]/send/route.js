"use strict";(()=>{var e={};e.id=9058,e.ids=[9058],e.modules={72934:e=>{e.exports=require("next/dist/client/components/action-async-storage.external.js")},54580:e=>{e.exports=require("next/dist/client/components/request-async-storage.external.js")},45869:e=>{e.exports=require("next/dist/client/components/static-generation-async-storage.external.js")},20399:e=>{e.exports=require("next/dist/compiled/next-server/app-page.runtime.prod.js")},30517:e=>{e.exports=require("next/dist/compiled/next-server/app-route.runtime.prod.js")},84770:e=>{e.exports=require("crypto")},6005:e=>{e.exports=require("node:crypto")},8813:(e,r,t)=>{t.r(r),t.d(r,{originalPathname:()=>y,patchFetch:()=>R,requestAsyncStorage:()=>x,routeModule:()=>g,serverHooks:()=>w,staticGenerationAsyncStorage:()=>h});var s={};t.r(s),t.d(s,{POST:()=>f});var i=t(49303),n=t(88716),o=t(60670),a=t(78459),p=t(87070),l=t(83493);let d=new(t(82591)).R(process.env.RESEND_API_KEY);async function u({to:e,clientName:r,quarter:t,year:s,mspName:i,portalUrl:n}){await d.emails.send({from:`${i} <noreply@misecuretechsolutions.com>`,to:e,subject:`Your Q${t} ${s} Quarterly Business Review — ${r}`,html:`
      <!DOCTYPE html>
      <html>
        <body style="margin:0;padding:0;background:#f4f5f7;font-family:Calibri,Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="padding:40px 20px;">
                <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
                  
                  <!-- Header -->
                  <tr>
                    <td style="background:#0a1634;padding:32px 40px;">
                      <p style="margin:0;color:#c9a02a;font-size:11px;letter-spacing:3px;text-transform:uppercase;">Quarterly Business Review</p>
                      <h1 style="margin:8px 0 0;color:#ffffff;font-size:24px;">${r}</h1>
                      <p style="margin:4px 0 0;color:#c9a02a;font-size:16px;">Q${t} ${s}</p>
                    </td>
                  </tr>

                  <!-- Gold bar -->
                  <tr><td style="background:#c9a02a;height:3px;"></td></tr>

                  <!-- Body -->
                  <tr>
                    <td style="padding:40px;">
                      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6;">
                        Dear ${r} team,
                      </p>
                      <p style="margin:0 0 24px;color:#374151;font-size:15px;line-height:1.6;">
                        Your Q${t} ${s} Quarterly Business Review is ready. Click the button below to view your full report online.
                      </p>

                      <!-- CTA Button -->
                      <table cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="background:#0a1634;border-radius:6px;">
                            <a href="${n}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;">
                              View Your QBR Report →
                            </a>
                          </td>
                        </tr>
                      </table>

                      <p style="margin:24px 0 0;color:#9ca3af;font-size:12px;">
                        Or copy this link into your browser:<br/>
                        <a href="${n}" style="color:#0a1634;">${n}</a>
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background:#f4f5f7;padding:24px 40px;border-top:1px solid #e5e7eb;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;">
                        Prepared by ${i} \xb7 Confidential<br/>
                        Powered by QBR Deck
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `})}var c=t(78864),b=t(95343),m=t(84770);async function f(e,{params:r}){try{let{userId:t}=(0,a.I)();if(!t)return p.NextResponse.json({error:"Unauthorized"},{status:401});let s=await (0,c.d)(t);if(!s)return p.NextResponse.json({error:"Workspace not found"},{status:404});if(!b.BT.exportQBR(s.role))return p.NextResponse.json({error:"Forbidden"},{status:403});let{email:i}=await e.json();if(!i)return p.NextResponse.json({error:"Email required"},{status:400});let n=await l.prisma.qBR.findFirst({where:{id:r.qbrId},include:{client:!0}});if(!n||n.client.workspaceId!==s.workspaceId)return p.NextResponse.json({error:"Not found"},{status:404});let o=n.shareToken??(0,m.randomBytes)(16).toString("hex");n.shareToken||await l.prisma.qBR.update({where:{id:r.qbrId},data:{shareToken:o}});let d=`/portal/${o}`,f=await l.prisma.workspace.findUnique({where:{id:s.workspaceId}}),g=f?.name??"MI Secure Tech Solutions";return await u({to:i,clientName:n.client.name,quarter:n.quarter,year:n.year,mspName:g,portalUrl:d}),p.NextResponse.json({success:!0})}catch(e){return console.error("[send-qbr]",e),p.NextResponse.json({error:e.message??"Failed to send"},{status:500})}}let g=new i.AppRouteRouteModule({definition:{kind:n.x.APP_ROUTE,page:"/api/qbrs/[qbrId]/send/route",pathname:"/api/qbrs/[qbrId]/send",filename:"route",bundlePath:"app/api/qbrs/[qbrId]/send/route"},resolvedPagePath:"C:\\Users\\Admin\\Downloads\\qbrdeck-source\\qbrdeck\\app\\api\\qbrs\\[qbrId]\\send\\route.ts",nextConfigOutput:"",userland:s}),{requestAsyncStorage:x,staticGenerationAsyncStorage:h,serverHooks:w}=g,y="/api/qbrs/[qbrId]/send/route";function R(){return(0,o.patchFetch)({serverHooks:w,staticGenerationAsyncStorage:h})}},95343:(e,r,t)=>{t.d(r,{BT:()=>n,K4:()=>o,fg:()=>a});let s={VIEWER:0,MEMBER:1,ADMIN:2,OWNER:3};function i(e,r){return s[e]>=s[r]}let n={manageBilling:e=>"OWNER"===e,manageSettings:e=>"OWNER"===e,inviteMembers:e=>i(e,"OWNER"),removeMembers:e=>"OWNER"===e,changeRoles:e=>"OWNER"===e,createClient:e=>i(e,"ADMIN"),editClient:e=>i(e,"ADMIN"),deleteClient:e=>i(e,"ADMIN"),viewClients:e=>i(e,"VIEWER"),generateQBR:e=>i(e,"MEMBER"),exportQBR:e=>i(e,"MEMBER"),viewQBR:e=>i(e,"VIEWER"),editQBRReminders:e=>i(e,"ADMIN")},o={FREE:1,SOLO:1,GROWTH:5,AGENCY:999};function a(e,r){return r<(o[e]??1)}},83493:(e,r,t)=>{t.d(r,{prisma:()=>i});let s=require("@prisma/client"),i=globalThis.prisma??new s.PrismaClient({log:["error"]})},78864:(e,r,t)=>{t.d(r,{d:()=>o,i:()=>n});var s=t(78459),i=t(83493);async function n(){let{userId:e}=(0,s.I)();if(!e)return null;let r=await i.prisma.user.findUnique({where:{clerkId:e},include:{memberships:{include:{workspace:{include:{subscription:!0}}},orderBy:{joinedAt:"asc"},take:1}}});if(!r)return null;if(r.memberships.length>0){let e=r.memberships[0],t=e.workspace;return{workspaceId:t.id,workspace:{id:t.id,name:t.name,logoUrl:t.logoUrl,slug:t.slug},member:{role:e.role,userId:r.id},subscription:t.subscription?{plan:t.subscription.plan,qbrCount:t.subscription.qbrCount,exportCount:t.subscription.exportCount,exportedQbrIds:t.subscription.exportedQbrIds,periodStart:t.subscription.periodStart,stripeCustomerId:t.subscription.stripeCustomerId,stripeSubscriptionId:t.subscription.stripeSubscriptionId}:null}}let t=await i.prisma.workspace.create({data:{name:r.name??r.email.split("@")[0]??"My Workspace",members:{create:{userId:r.id,role:"OWNER"}}},include:{subscription:!0}});return{workspaceId:t.id,workspace:{id:t.id,name:t.name,logoUrl:t.logoUrl,slug:t.slug},member:{role:"OWNER",userId:r.id},subscription:null}}async function o(e){let r=await i.prisma.user.findUnique({where:{clerkId:e},include:{memberships:{include:{workspace:{include:{subscription:!0}}},orderBy:{joinedAt:"asc"},take:1}}});if(!r||0===r.memberships.length)return null;let t=r.memberships[0];return{userId:r.id,user:r,workspaceId:t.workspaceId,role:t.role,workspace:t.workspace,subscription:t.workspace.subscription}}}};var r=require("../../../../../webpack-runtime.js");r.C(e);var t=e=>r(r.s=e),s=r.X(0,[2510,8459,6441],()=>t(8813));module.exports=s})();