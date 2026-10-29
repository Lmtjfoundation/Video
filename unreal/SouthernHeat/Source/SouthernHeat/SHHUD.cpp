#include "SHHUD.h"
#include "SHGameMode.h"
#include "SHWorldBuilder.h"
#include "SHVehicle.h"
#include "SHPed.h"
#include "SHPlayerCharacter.h"
#include "Engine/Canvas.h"
#include "Engine/Engine.h"
#include "Engine/Font.h"
#include "GameFramework/PlayerController.h"

namespace
{
	constexpr float WMIN_X = -3300.f, WMAX_X = 3300.f, WMIN_Z = -1500.f, WMAX_Z = 2350.f;
	FString Commas(int64 N) { return FText::AsNumber(N).ToString(); }
}

void ASHHUD::Txt(const FString& Str, float X, float Y, const FLinearColor& C, UFont* Font, float Scale, int32 Align)
{
	float W = 0.f, H = 0.f;
	GetTextSize(Str, W, H, Font, Scale);
	if (Align == 1) X -= W * 0.5f;
	else if (Align == 2) X -= W;
	DrawText(Str, FLinearColor(0.f, 0.f, 0.f, C.A * 0.85f), X + 2.f, Y + 2.f, Font, Scale);
	DrawText(Str, C, X, Y, Font, Scale);
}

void ASHHUD::ClippedLine(FVector2D A, FVector2D B, const FVector4& R, const FLinearColor& C, float Thick)
{
	// Liang-Barsky clip to the rectangle (x, y, w, h)
	const double X0 = R.X, Y0 = R.Y, X1 = R.X + R.Z, Y1 = R.Y + R.W;
	const double Dx = B.X - A.X, Dy = B.Y - A.Y;
	double T0 = 0.0, T1 = 1.0;
	const double P[4] = { -Dx, Dx, -Dy, Dy };
	const double Q[4] = { A.X - X0, X1 - A.X, A.Y - Y0, Y1 - A.Y };
	for (int32 i = 0; i < 4; ++i)
	{
		if (FMath::IsNearlyZero(P[i])) { if (Q[i] < 0.0) return; continue; }
		const double T = Q[i] / P[i];
		if (P[i] < 0.0) { if (T > T1) return; T0 = FMath::Max(T0, T); }
		else { if (T < T0) return; T1 = FMath::Min(T1, T); }
	}
	const FVector2D PA = A + FVector2D(Dx, Dy) * T0, PB = A + FVector2D(Dx, Dy) * T1;
	DrawLine(PA.X, PA.Y, PB.X, PB.Y, C, Thick);
}

void ASHHUD::UpdateRoute(ASHGameMode* GM)
{
	const bool bTarget = GM->bHasGps || GM->bHasWaypoint;
	if (!bTarget) { Route.Reset(); return; }
	RouteTimer -= GetWorld()->GetDeltaSeconds();
	if (RouteTimer > 0.f) return;
	RouteTimer = 1.2f;
	const FVector2D T = GM->bHasGps ? GM->Gps : GM->Waypoint;
	const FVector PP = GM->PlayerPos();
	const FVector2D PM(PP.X / 100.f, PP.Y / 100.f);
	TArray<int32> Path;
	Route.Reset();
	Route.Add(PM);
	if (GM->World->FindPath(GM->World->NearestNode(PM.X, PM.Y), GM->World->NearestNode(T.X, T.Y), Path))
		for (int32 N : Path) Route.Add(GM->World->Nodes[N].P);
	Route.Add(T);
	if (GM->bHasWaypoint && !GM->bHasGps && FVector2D::Distance(PM, GM->Waypoint) < 20.f) GM->bHasWaypoint = false;
}

void ASHHUD::DrawHUD()
{
	Super::DrawHUD();
	ASHGameMode* GM = ASHGameMode::Get(this);
	if (!GM || !GM->World || !Canvas) return;
	const float S = Canvas->ClipY / 1080.f;
	if (APlayerController* PC = GetOwningPlayerController()) CamYaw = PC->GetControlRotation().Yaw;
	UpdateRoute(GM);
	if (GM->bMapOpen) { DrawBigMap(GM, S); return; }
	if (GM->DamageFlash > 0.f) DrawRect(FLinearColor(0.8f, 0.f, 0.f, FMath::Min(0.5f, GM->DamageFlash)), 0.f, 0.f, Canvas->ClipX, Canvas->ClipY);
	if (GM->bPlayerDead) DrawRect(FLinearColor(0.15f, 0.f, 0.f, 0.35f), 0.f, 0.f, Canvas->ClipX, Canvas->ClipY);
	DrawMinimap(GM, S);
	DrawStatus(GM, S);
	DrawMessages(GM, S);
}

// ---------------------------------------------------------------- minimap
void ASHHUD::DrawMinimap(ASHGameMode* GM, float S)
{
	const float MW = 380.f * S, MH = 250.f * S, MX = 30.f * S, MY = Canvas->ClipY - MH - 60.f * S;
	const FVector4 R(MX, MY, MW, MH);
	DrawRect(FLinearColor(0.2f, 0.26f, 0.22f, 0.92f), MX, MY, MW, MH);
	const FVector PP = GM->PlayerPos();
	const FVector2D PM(PP.X / 100.f, PP.Y / 100.f);
	const float Speed = GM->PlayerVehicle ? GM->PlayerVehicle->SpeedMs() : 0.f;
	const float Alt = GM->PlayerVehicle && GM->PlayerVehicle->Def->bHeli ? PP.Z / 100.f : 0.f;
	const float Zoom = FMath::Clamp(1.6f - Speed * 0.02f - Alt * 0.004f, 0.4f, 1.6f) * S;
	const FVector2D C(MX + MW * 0.5f, MY + MH * 0.62f);
	const float Yr = FMath::DegreesToRadians(CamYaw);
	const FVector2D F(FMath::Cos(Yr), FMath::Sin(Yr)), Rt(-FMath::Sin(Yr), FMath::Cos(Yr));
	auto ToMap = [&](const FVector2D& P) { const FVector2D D = P - PM; return C + FVector2D(FVector2D::DotProduct(D, Rt), -FVector2D::DotProduct(D, F)) * Zoom; };
	auto Inside = [&](const FVector2D& P) { return P.X >= MX && P.X <= MX + MW && P.Y >= MY && P.Y <= MY + MH; };
	auto Clamp = [&](FVector2D P) { return FVector2D(FMath::Clamp(P.X, MX + 8.f, MX + MW - 8.f), FMath::Clamp(P.Y, MY + 8.f, MY + MH - 8.f)); };

	const ASHWorldBuilder* W = GM->World;
	for (const FSHRect& Wt : W->Waters)
	{
		const FVector2D A = ToMap(FVector2D(Wt.MinX, Wt.MinZ)), B = ToMap(FVector2D(Wt.MaxX, Wt.MinZ)), Cc = ToMap(FVector2D(Wt.MaxX, Wt.MaxZ)), D = ToMap(FVector2D(Wt.MinX, Wt.MaxZ));
		const FLinearColor Blue(0.25f, 0.52f, 0.72f);
		ClippedLine(A, B, R, Blue, 4.f * S); ClippedLine(B, Cc, R, Blue, 4.f * S); ClippedLine(Cc, D, R, Blue, 4.f * S); ClippedLine(D, A, R, Blue, 4.f * S);
	}
	for (const FSHRoadEdge& E : W->Edges)
	{
		const FVector2D A = ToMap(W->Nodes[E.A].P), B = ToMap(W->Nodes[E.B].P);
		ClippedLine(A, B, R, E.bHighway ? FLinearColor(0.88f, 0.71f, 0.29f) : FLinearColor(0.85f, 0.86f, 0.88f), (E.bHighway ? 12.f : 8.f) * Zoom);
	}
	if (Route.Num() > 1)
	{
		const FLinearColor RC = GM->bHasGps ? FLinearColor(0.95f, 0.76f, 0.19f) : FLinearColor(0.75f, 0.38f, 1.f);
		for (int32 i = 0; i + 1 < Route.Num(); ++i) ClippedLine(ToMap(Route[i]), ToMap(Route[i + 1]), R, RC, 5.f * S);
	}
	// icons
	for (const FSHLabel& L : W->Labels)
	{
		if (L.Kind != 2) continue;
		const FVector2D P = ToMap(L.P);
		if (Inside(P)) Txt(L.Text, P.X, P.Y - 10.f * S, L.Color, GEngine->GetMediumFont(), 1.f * S, 1);
	}
	if (GM->Active < 0)
		for (const FSHMission& M : GM->Missions)
		{
			const FVector2D P = Clamp(ToMap(M.Marker));
			DrawRect(M.Color, P.X - 10.f * S, P.Y - 10.f * S, 20.f * S, 20.f * S);
			Txt(FString(1, &M.Letter), P.X, P.Y - 9.f * S, FLinearColor::Black, GEngine->GetSmallFont(), 1.1f * S, 1);
		}
	const bool bFlash = FMath::Fmod(GetWorld()->GetRealTimeSeconds(), 0.5f) < 0.25f;
	for (ASHVehicle* V : GM->Vehicles)
	{
		if (!V || V == GM->PlayerVehicle || V->bDead) continue;
		const bool bCop = V->Def->bPolice && (V->bSiren || V->Def->bHeli);
		if (!bCop && !V->bMissionVehicle) continue;
		FVector2D P = ToMap(FVector2D(V->GetActorLocation().X, V->GetActorLocation().Y) / 100.f);
		if (!Inside(P)) { if (!bCop || GM->WantedLevel == 0) continue; P = Clamp(P); }
		const FLinearColor Col = bCop ? (bFlash ? FLinearColor(1.f, 0.15f, 0.15f) : FLinearColor(0.2f, 0.4f, 1.f)) : FLinearColor(0.3f, 0.9f, 1.f);
		DrawRect(Col, P.X - 5.f * S, P.Y - 5.f * S, 10.f * S, 10.f * S);
	}
	for (ASHPed* P : GM->Peds)
	{
		if (!P || !P->IsAlive() || !(P->State == ESHPedState::Attack || P->bHostile)) continue;
		const FVector2D Q = ToMap(FVector2D(P->GetActorLocation().X, P->GetActorLocation().Y) / 100.f);
		if (Inside(Q)) DrawRect(FLinearColor(1.f, 0.25f, 0.25f), Q.X - 3.f * S, Q.Y - 3.f * S, 6.f * S, 6.f * S);
	}
	if (GM->bHasGps) { const FVector2D P = Clamp(ToMap(GM->Gps)); DrawRect(FLinearColor(0.95f, 0.76f, 0.19f), P.X - 7.f * S, P.Y - 7.f * S, 14.f * S, 14.f * S); }
	if (GM->bHasWaypoint) { const FVector2D P = Clamp(ToMap(GM->Waypoint)); DrawRect(FLinearColor(0.75f, 0.38f, 1.f), P.X - 7.f * S, P.Y - 7.f * S, 14.f * S, 14.f * S); }
	// north marker
	{
		const FVector2D N = Clamp(ToMap(PM + FVector2D(0.f, -100000.f)));
		Txt(TEXT("N"), N.X, N.Y - 10.f * S, FLinearColor::White, GEngine->GetMediumFont(), 1.f * S, 1);
	}
	// player arrow
	const float PlayerYaw = GM->PlayerVehicle ? GM->PlayerVehicle->Yaw : (GM->PlayerChar ? GM->PlayerChar->GetActorRotation().Yaw : 0.f);
	const float Rel = FMath::DegreesToRadians(PlayerYaw - CamYaw);
	auto Dir = [&](float A) { return FVector2D(FMath::Sin(Rel + A), -FMath::Cos(Rel + A)); };
	const FVector2D Tip = C + Dir(0.f) * 14.f * S, L = C + Dir(2.5f) * 10.f * S, Rr = C + Dir(-2.5f) * 10.f * S;
	DrawLine(Tip.X, Tip.Y, L.X, L.Y, FLinearColor::White, 3.f * S);
	DrawLine(Tip.X, Tip.Y, Rr.X, Rr.Y, FLinearColor::White, 3.f * S);
	DrawLine(L.X, L.Y, C.X, C.Y, FLinearColor::White, 3.f * S);
	DrawLine(Rr.X, Rr.Y, C.X, C.Y, FLinearColor::White, 3.f * S);
	// frame (flashes red/blue when wanted)
	const FLinearColor Frame = GM->WantedLevel > 0 ? (bFlash ? FLinearColor(1.f, 0.15f, 0.15f) : FLinearColor(0.2f, 0.4f, 1.f)) : FLinearColor(0.f, 0.f, 0.f, 0.8f);
	const float T = 4.f * S;
	DrawRect(Frame, MX, MY, MW, T); DrawRect(Frame, MX, MY + MH - T, MW, T); DrawRect(Frame, MX, MY, T, MH); DrawRect(Frame, MX + MW - T, MY, T, MH);
	// health / armour / nitro bars
	const float BY = MY + MH + 6.f * S, BH = 10.f * S;
	const float Hp = GM->PlayerChar ? FMath::Clamp(GM->PlayerChar->Health / 100.f, 0.f, 1.f) : 0.f;
	const float Ar = GM->PlayerChar ? FMath::Clamp(GM->PlayerChar->Armor / 100.f, 0.f, 1.f) : 0.f;
	const float BW = (MW - 8.f * S) * 0.4f;
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.6f), MX, BY, BW, BH);
	DrawRect(Hp < 0.25f && bFlash ? FLinearColor(0.85f, 0.2f, 0.2f) : FLinearColor(0.45f, 0.78f, 0.42f), MX, BY, BW * Hp, BH);
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.6f), MX + BW + 4.f * S, BY, BW, BH);
	DrawRect(FLinearColor(0.29f, 0.64f, 0.87f), MX + BW + 4.f * S, BY, BW * Ar, BH);
	const float NW = MW - BW * 2.f - 8.f * S;
	DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.6f), MX + BW * 2.f + 8.f * S, BY, NW, BH);
	DrawRect(FLinearColor(0.48f, 0.83f, 1.f), MX + BW * 2.f + 8.f * S, BY, NW * GM->Nitro, BH);
}

// ----------------------------------------------------------------- status
void ASHHUD::DrawStatus(ASHGameMode* GM, float S)
{
	const float RX = Canvas->ClipX - 40.f * S;
	float Y = 30.f * S;
	UFont* Large = GEngine->GetLargeFont();
	UFont* Med = GEngine->GetMediumFont();
	// wanted stars
	if (GM->WantedLevel > 0)
	{
		const bool bBlink = !GM->bWantedSeen && FMath::Fmod(GetWorld()->GetRealTimeSeconds(), 0.5f) < 0.25f;
		for (int32 i = 0; i < 5; ++i)
		{
			const float X = RX - (5 - i) * 36.f * S;
			const bool bOn = i < GM->WantedLevel;
			const FLinearColor C = bOn ? (bBlink ? FLinearColor(0.6f, 0.7f, 1.f) : FLinearColor::White) : FLinearColor(1.f, 1.f, 1.f, 0.18f);
			Txt(TEXT("*"), X + 14.f * S, Y - 8.f * S, C, Large, 2.2f * S, 1);
		}
		Y += 40.f * S;
	}
	if (GM->PlayerChar)
	{
		const ESHWeapon Wp = GM->PlayerChar->Weapon;
		const FSHWeaponDef& W = SHWeaponDef(Wp);
		const FString Ammo = W.bMelee ? FString() : GM->bInfiniteAmmo ? TEXT("  INF") : FString::Printf(TEXT("  %d"), GM->PlayerChar->Ammo[(int32)Wp]);
		Txt(FString(W.Name) + Ammo, RX, Y, FLinearColor::White, Med, 1.3f * S, 2);
		Y += 34.f * S;
	}
	Txt(TEXT("$") + Commas(GM->Money), RX, Y, FLinearColor(0.5f, 0.83f, 0.47f), Large, 2.f * S, 2);
	Y += 56.f * S;
	if (GM->MissionTimer >= 0.f && GM->Active >= 0)
	{
		const int32 Sec = FMath::Max(0, FMath::CeilToInt(GM->MissionTimer));
		Txt(FString::Printf(TEXT("%d:%02d"), Sec / 60, Sec % 60), RX, Y, Sec <= 15 ? FLinearColor(1.f, 0.36f, 0.36f) : FLinearColor::White, Large, 1.8f * S, 2);
		Y += 50.f * S;
	}
	// zone + vehicle, bottom right
	const FVector PP = GM->PlayerPos();
	FString City; FLinearColor ZoneColor;
	const FString District = GM->World->ZoneName(PP.X / 100.f, PP.Y / 100.f, City, ZoneColor);
	float BY = Canvas->ClipY - 70.f * S;
	if (!City.IsEmpty()) { Txt(City, RX, BY, ZoneColor, Med, 1.3f * S, 2); BY -= 44.f * S; }
	Txt(District, RX, BY, FLinearColor::White, Large, 1.5f * S, 2);
	if (ASHVehicle* V = GM->PlayerVehicle)
	{
		BY -= 60.f * S;
		Txt(FString::Printf(TEXT("%d MPH"), FMath::RoundToInt(V->SpeedMs() * 2.237f)), RX, BY, FLinearColor::White, Large, 2.f * S, 2);
		BY -= 34.f * S;
		FString Sub = V->Def->Name;
		if (V->Def->bHeli) Sub += FString::Printf(TEXT("   ALT %dm"), FMath::RoundToInt(V->GetActorLocation().Z / 100.f));
		else if (V->Health < V->MaxHealth * 0.3f) Sub += TEXT("   ENGINE DAMAGED");
		Txt(Sub, RX, BY, FLinearColor(1.f, 0.85f, 0.54f), Med, 1.1f * S, 2);
	}
	// crosshair
	const bool bArmed = GM->PlayerVehicle ? (GM->PlayerVehicle->Kind == ESHVehicleKind::Tank || GM->PlayerVehicle->Kind == ESHVehicleKind::Heli)
		: (GM->PlayerChar && GM->PlayerChar->Weapon != ESHWeapon::Fist);
	if (bArmed && !GM->bPlayerDead)
	{
		const float CX = Canvas->ClipX * 0.5f, CY = Canvas->ClipY * 0.5f;
		DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.6f), CX - 4.f * S, CY - 4.f * S, 8.f * S, 8.f * S);
		DrawRect(FLinearColor::White, CX - 2.5f * S, CY - 2.5f * S, 5.f * S, 5.f * S);
	}
}

// --------------------------------------------------------------- messages
void ASHHUD::DrawMessages(ASHGameMode* GM, float S)
{
	UFont* Large = GEngine->GetLargeFont();
	UFont* Med = GEngine->GetMediumFont();
	const float CX = Canvas->ClipX * 0.5f;
	if (GM->BigTimer > 0.f)
	{
		const float A = FMath::Clamp(GM->BigTimer * 2.f, 0.f, 1.f);
		FLinearColor C = GM->BigColor; C.A = A;
		if (!GM->BigSub.IsEmpty() && GM->BigSub.Len() < 16) Txt(GM->BigSub, CX, Canvas->ClipY * 0.36f - 40.f * S, FLinearColor(1.f, 1.f, 1.f, A), Med, 1.6f * S, 1);
		Txt(GM->BigText, CX, Canvas->ClipY * 0.36f, C, Large, 4.f * S, 1);
		if (!GM->BigSub.IsEmpty() && GM->BigSub.Len() >= 16) Txt(GM->BigSub, CX, Canvas->ClipY * 0.36f + 110.f * S, FLinearColor(1.f, 1.f, 1.f, A), Med, 1.5f * S, 1);
	}
	if (GM->StuntTimer > 0.f)
	{
		Txt(GM->StuntText, CX, Canvas->ClipY * 0.2f, FLinearColor(0.95f, 0.76f, 0.19f), Large, 2.6f * S, 1);
		Txt(GM->StuntSub, CX, Canvas->ClipY * 0.2f + 70.f * S, FLinearColor::White, Med, 1.3f * S, 1);
	}
	if (GM->HelpTimer > 0.f && !GM->HelpText.IsEmpty())
	{
		TArray<FString> Lines;
		GM->HelpText.ParseIntoArray(Lines, TEXT("\n"), true);
		float MaxW = 0.f;
		for (const FString& L : Lines) { float W, H; GetTextSize(L, W, H, Med, 1.1f * S); MaxW = FMath::Max(MaxW, W); }
		DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.78f), 30.f * S, 30.f * S, MaxW + 36.f * S, Lines.Num() * 30.f * S + 24.f * S);
		for (int32 i = 0; i < Lines.Num(); ++i) Txt(Lines[i], 48.f * S, 42.f * S + i * 30.f * S, FLinearColor::White, Med, 1.1f * S);
	}
	if (GM->HintTimer > 0.f)
	{
		float W, H; GetTextSize(GM->HintText, W, H, Med, 1.2f * S);
		DrawRect(FLinearColor(0.f, 0.f, 0.f, 0.7f), CX - W * 0.5f - 14.f * S, Canvas->ClipY - 200.f * S, W + 28.f * S, H + 12.f * S);
		Txt(GM->HintText, CX, Canvas->ClipY - 194.f * S, FLinearColor::White, Med, 1.2f * S, 1);
	}
	if (!GM->Objective.IsEmpty() && GM->Active >= 0)
		Txt(GM->Objective, CX, Canvas->ClipY - 110.f * S, FLinearColor::White, Med, 1.4f * S, 1);
}

// ---------------------------------------------------------------- big map
bool ASHHUD::MapScreenToWorld(float X, float Y, FVector2D& OutWorld) const
{
	if (MapScale <= 0.f) return false;
	if (X < MapRect.X || Y < MapRect.Y || X > MapRect.X + MapRect.Z || Y > MapRect.Y + MapRect.W) return false;
	OutWorld = FVector2D(WMIN_X + (X - MapRect.X) / MapScale, WMIN_Z + (Y - MapRect.Y) / MapScale);
	return true;
}

void ASHHUD::DrawBigMap(ASHGameMode* GM, float S)
{
	const float CW = Canvas->ClipX, CH = Canvas->ClipY;
	DrawRect(FLinearColor(0.03f, 0.05f, 0.07f, 0.97f), 0.f, 0.f, CW, CH);
	const float WW = WMAX_X - WMIN_X, WH = WMAX_Z - WMIN_Z;
	MapScale = FMath::Min(CW * 0.94f / WW, CH * 0.86f / WH);
	MapRect = FVector4((CW - WW * MapScale) * 0.5f, (CH - WH * MapScale) * 0.5f + 20.f * S, WW * MapScale, WH * MapScale);
	auto ToS = [&](const FVector2D& P) { return FVector2D(MapRect.X + (P.X - WMIN_X) * MapScale, MapRect.Y + (P.Y - WMIN_Z) * MapScale); };
	DrawRect(FLinearColor(0.24f, 0.3f, 0.23f), MapRect.X, MapRect.Y, MapRect.Z, MapRect.W);
	const ASHWorldBuilder* W = GM->World;
	for (const FSHRect& Wt : W->Waters)
	{
		const FVector2D A = ToS(FVector2D(Wt.MinX, Wt.MinZ)), B = ToS(FVector2D(Wt.MaxX, Wt.MaxZ));
		DrawRect(FLinearColor(0.25f, 0.52f, 0.72f), A.X, A.Y, B.X - A.X, B.Y - A.Y);
	}
	for (const FSHCityDef& C : W->Cities)
	{
		const FVector2D A = ToS(FVector2D(C.CX - 409.f, C.CZ - 409.f)), B = ToS(FVector2D(C.CX + 409.f, C.CZ + 409.f));
		DrawRect(FLinearColor(0.3f, 0.31f, 0.34f), A.X, A.Y, B.X - A.X, B.Y - A.Y);
	}
	for (const FSHRoadEdge& E : W->Edges)
	{
		const FVector2D A = ToS(W->Nodes[E.A].P), B = ToS(W->Nodes[E.B].P);
		DrawLine(A.X, A.Y, B.X, B.Y, E.bHighway ? FLinearColor(0.88f, 0.71f, 0.29f) : FLinearColor(0.85f, 0.86f, 0.88f), E.bHighway ? 3.f * S : 1.5f * S);
	}
	if (Route.Num() > 1)
		for (int32 i = 0; i + 1 < Route.Num(); ++i)
		{
			const FVector2D A = ToS(Route[i]), B = ToS(Route[i + 1]);
			DrawLine(A.X, A.Y, B.X, B.Y, GM->bHasGps ? FLinearColor(0.95f, 0.76f, 0.19f) : FLinearColor(0.75f, 0.38f, 1.f), 4.f * S);
		}
	UFont* Large = GEngine->GetLargeFont();
	UFont* Small = GEngine->GetSmallFont();
	for (const FSHLabel& L : W->Labels)
	{
		const FVector2D P = ToS(L.P);
		if (L.Kind == 1) Txt(L.Text, P.X, P.Y - 20.f * S, L.Color, Large, 2.f * S, 1);
		else if (L.Kind == 2) Txt(L.Text, P.X, P.Y - 10.f * S, L.Color, GEngine->GetMediumFont(), 1.f * S, 1);
		else Txt(L.Text, P.X, P.Y + 4.f * S, FLinearColor(1.f, 1.f, 1.f, 0.75f), Small, 0.9f * S, 1);
	}
	for (const FSHMission& M : GM->Missions)
	{
		const FVector2D P = ToS(M.Marker);
		DrawRect(M.Color, P.X - 11.f * S, P.Y - 11.f * S, 22.f * S, 22.f * S);
		Txt(FString(1, &M.Letter), P.X, P.Y - 10.f * S, FLinearColor::Black, GEngine->GetMediumFont(), 1.1f * S, 1);
		if (GM->Completed.Contains(M.Id)) Txt(TEXT("OK"), P.X + 24.f * S, P.Y - 10.f * S, FLinearColor::White, Small, 1.f * S);
	}
	if (GM->bHasWaypoint) { const FVector2D P = ToS(GM->Waypoint); DrawRect(FLinearColor(0.75f, 0.38f, 1.f), P.X - 8.f * S, P.Y - 8.f * S, 16.f * S, 16.f * S); }
	const FVector PP = GM->PlayerPos();
	const FVector2D Me = ToS(FVector2D(PP.X, PP.Y) / 100.f);
	DrawRect(FLinearColor::White, Me.X - 7.f * S, Me.Y - 7.f * S, 14.f * S, 14.f * S);
	DrawRect(FLinearColor::Black, Me.X - 3.f * S, Me.Y - 3.f * S, 6.f * S, 6.f * S);
	Txt(TEXT("MAP  -  left click: set GPS waypoint   right click: clear   M: close"), CW * 0.5f, 18.f * S, FLinearColor::White, GEngine->GetMediumFont(), 1.2f * S, 1);
}
