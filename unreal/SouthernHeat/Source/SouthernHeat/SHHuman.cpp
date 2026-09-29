#include "SHHuman.h"
#include "SHGameMode.h"
#include "SHTypes.h"
#include "Components/SceneComponent.h"
#include "Components/StaticMeshComponent.h"
#include "GameFramework/Actor.h"

namespace
{
	const TCHAR* SKIN[] = { TEXT("F3CFB3"), TEXT("E8B896"), TEXT("D49A72"), TEXT("B87D56"), TEXT("8D5A3B"), TEXT("6B4329"), TEXT("4A2E1C") };
	const TCHAR* SHIRTS[] = { TEXT("E8E8E8"), TEXT("B22222"), TEXT("1F3F8A"), TEXT("2E7D32"), TEXT("F9A825"), TEXT("6A1B9A"), TEXT("212121"), TEXT("FF7043"), TEXT("00838F"), TEXT("C2185B"), TEXT("8D6E63"), TEXT("5B7FA6") };
	const TCHAR* PANTS[] = { TEXT("1F2D4A"), TEXT("2B2B2B"), TEXT("5D4037"), TEXT("3E4B3A"), TEXT("C8B58A"), TEXT("455A64"), TEXT("3B5A8A") };
	const TCHAR* HAIR[] = { TEXT("141110"), TEXT("2B1D14"), TEXT("4A3222"), TEXT("7A5230"), TEXT("C9A15A"), TEXT("8A8A8A") };
	const TCHAR* SHOES[] = { TEXT("161616"), TEXT("F0F0F0"), TEXT("5A3A22"), TEXT("2D2D4A") };
	template <SIZE_T N> FLinearColor Pick(const TCHAR* const (&Arr)[N]) { return SH::Hex(Arr[FMath::RandRange(0, (int32)N - 1)]); }

	USceneComponent* Joint(AActor* Owner, USceneComponent* Parent, const FVector& Loc)
	{
		USceneComponent* J = NewObject<USceneComponent>(Owner);
		J->SetupAttachment(Parent);
		J->SetRelativeLocation(Loc);
		J->RegisterComponent();
		Owner->AddInstanceComponent(J);
		return J;
	}
}

FSHLook FSHLook::Random(int32 City)
{
	FSHLook L;
	L.bFemale = FMath::FRand() < 0.48f;
	L.Skin = Pick(SKIN);
	L.Shirt = Pick(SHIRTS);
	L.Pants = Pick(PANTS);
	L.Hair = Pick(HAIR);
	L.Shoes = Pick(SHOES);
	L.bShortSleeves = FMath::FRand() < 0.55f;
	L.bSkirt = L.bFemale && FMath::FRand() < 0.4f;
	L.HairStyle = L.bFemale ? FMath::RandRange(0, 2) == 0 ? 1 : FMath::RandRange(1, 2) : (FMath::FRand() < 0.15f ? 3 : FMath::FRand() < 0.2f ? 4 : 0);
	L.Height = L.bFemale ? FMath::FRandRange(0.92f, 1.f) : FMath::FRandRange(0.97f, 1.06f);
	L.Build = L.bFemale ? FMath::FRandRange(0.86f, 1.f) : FMath::FRandRange(0.95f, 1.2f);
	if (City == 0 && FMath::FRand() < 0.25f) { L.Hat = 2; L.HatColor = SH::Hex(TEXT("E8DCC2")); }
	else if (FMath::FRand() < 0.12f) { L.Hat = 3; L.HatColor = Pick(SHIRTS); }
	L.bBeads = City == 1 && FMath::FRand() < 0.35f;
	return L;
}

FSHLook FSHLook::Cop()
{
	FSHLook L = Random(-1);
	L.bFemale = FMath::FRand() < 0.2f; L.bSkirt = false;
	L.Shirt = SH::Hex(TEXT("2C4A8A")); L.Pants = SH::Hex(TEXT("10204A")); L.Shoes = SH::Hex(TEXT("111111"));
	L.Hat = 1; L.HatColor = SH::Hex(TEXT("10204A")); L.bArmed = true; L.bShortSleeves = true; L.HairStyle = 0;
	return L;
}

FSHLook FSHLook::Swat()
{
	FSHLook L = Cop();
	L.bFemale = false;
	L.Shirt = SH::Hex(TEXT("2A2D30")); L.Pants = SH::Hex(TEXT("23262A"));
	L.Hat = 3; L.HatColor = SH::Hex(TEXT("111111")); L.bVest = true; L.bShortSleeves = false;
	return L;
}

FSHLook FSHLook::Gang(const FLinearColor& Color)
{
	FSHLook L = Random(-1);
	L.bFemale = FMath::FRand() < 0.15f; L.bSkirt = false;
	L.Shirt = Color; L.Hat = 3; L.HatColor = Color; L.bArmed = true;
	return L;
}

FSHLook FSHLook::Player()
{
	FSHLook L;
	L.Skin = SH::Hex(TEXT("8D5A3B")); L.Shirt = SH::Hex(TEXT("2E7D32")); L.Pants = SH::Hex(TEXT("C8B58A"));
	L.Hair = SH::Hex(TEXT("111111")); L.Shoes = SH::Hex(TEXT("F0F0F0"));
	L.bArmed = true; L.bShortSleeves = true; L.HairStyle = 0; L.Height = 1.03f; L.Build = 1.12f;
	return L;
}

void FSHHumanRig::Build(AActor* Owner, USceneComponent* Parent, const FSHLook& Look)
{
	ASHGameMode* GM = ASHGameMode::Get(Owner);
	GM->EnsureAssets();
	UStaticMesh* Cube = GM->CubeMesh;
	UStaticMesh* Cyl = GM->CylinderMesh;
	UStaticMesh* Sph = GM->SphereMesh;
	UStaticMesh* Cone = GM->ConeMesh;
	// Part: location in cm, size in cm
	auto Part = [&](USceneComponent* P, UStaticMesh* M, const FVector& Loc, const FVector& SizeCm, const FLinearColor& C, const FRotator& R = FRotator::ZeroRotator)
	{
		return GM->AddPart(Owner, P, M, Loc, SizeCm / 100.f, C, R);
	};
	const float Bw = Look.Build * (Look.bFemale ? 0.9f : 1.f);
	const float HipW = Look.bFemale ? 1.12f : 1.f;
	const FLinearColor Shade = Look.Skin * 0.85f;
	const FLinearColor Lip = FMath::Lerp(Look.Skin * 0.72f, SH::Hex(TEXT("9A3B3B")), Look.bFemale ? 0.45f : 0.15f);

	Root = Joint(Owner, Parent, FVector::ZeroVector);
	Root->SetRelativeScale3D(FVector(Look.Height));
	Torso = Joint(Owner, Root, FVector::ZeroVector);

	// pelvis + torso
	Part(Torso, Sph, FVector(0, 0, 97), FVector(22, 34 * HipW, 22), Look.Pants);
	Part(Torso, Cyl, FVector(0, 0, 118), FVector(22, 32 * Bw, 30), Look.Shirt);
	Part(Torso, Sph, FVector(0.5f, 0, 134), FVector(25, 40 * Bw, 26), Look.Shirt);
	if (Look.bFemale)
	{
		Part(Torso, Sph, FVector(9, -7, 132), FVector(12, 12, 11), Look.Shirt);
		Part(Torso, Sph, FVector(9, 7, 132), FVector(12, 12, 11), Look.Shirt);
	}
	if (Look.bVest) Part(Torso, Cube, FVector(0, 0, 126), FVector(28, 40 * Bw, 36), SH::Hex(TEXT("15171A")));
	if (Look.bSkirt) Part(Torso, Cone, FVector(0, 0, 84), FVector(52, 52, 46), Look.Pants);
	// neck & head
	Part(Torso, Cyl, FVector(0.5f, 0, 150), FVector(10, 10, 12), Look.Skin);
	Part(Torso, Sph, FVector(1, 0, 166), FVector(20, 18, 23), Look.Skin);
	Part(Torso, Sph, FVector(3.5f, 0, 159.5f), FVector(15, 14, 11), Look.Skin);
	Part(Torso, Sph, FVector(0, -9.8f, 166), FVector(2.5f, 1.4f, 4.4f), Shade);
	Part(Torso, Sph, FVector(0, 9.8f, 166), FVector(2.5f, 1.4f, 4.4f), Shade);
	for (int32 S = -1; S <= 1; S += 2)
	{
		Part(Torso, Sph, FVector(9.2f, S * 3.6f, 168.5f), FVector(3.4f, 3.4f, 3.4f), SH::Hex(TEXT("F4F1EA")));
		Part(Torso, Sph, FVector(10.6f, S * 3.6f, 168.5f), FVector(1.8f, 1.8f, 1.8f), SH::Hex(TEXT("1E1712")));
		Part(Torso, Cube, FVector(9.8f, S * 3.7f, 171.6f), FVector(1.f, 4.4f, 0.8f), Look.Hair, FRotator(0.f, 0.f, S * (Look.bFemale ? -7.f : -3.f)));
	}
	Part(Torso, Cone, FVector(11.2f, 0, 165.8f), FVector(3.4f, 3.4f, 5.f), Shade, FRotator(-90.f, 0.f, 0.f));
	Part(Torso, Cube, FVector(10.f, 0, 161.f), FVector(0.8f, 4.2f, 0.9f), Lip);
	// hair / hats
	if (Look.HairStyle != 3 || Look.Hat != 0)
		Part(Torso, Sph, FVector(-3, 0, 172), FVector(21, 20, 17), Look.Hair);
	if (Look.HairStyle == 1 && Look.Hat == 0) Part(Torso, Cube, FVector(-8.5f, 0, 156), FVector(5, 19, 30), Look.Hair);
	if (Look.HairStyle == 2 && Look.Hat == 0) Part(Torso, Sph, FVector(-8, 0, 179), FVector(10, 10, 10), Look.Hair);
	if (Look.HairStyle == 4 && Look.Hat == 0)
		for (int32 K = 0; K < 7; ++K)
		{
			const float A = K / 7.f * 2.f * PI;
			Part(Torso, Sph, FVector(FMath::Cos(A) * 6.f - 2.f, FMath::Sin(A) * 7.f, 177.f), FVector(9, 9, 9), Look.Hair);
		}
	if (Look.Hat == 1)
	{
		Part(Torso, Cyl, FVector(-1, 0, 179), FVector(22, 22, 8), Look.HatColor);
		Part(Torso, Cube, FVector(10, 0, 176), FVector(9, 18, 1.2f), SH::Hex(TEXT("0A0A0A")));
		Part(Torso, Cube, FVector(11, 0, 180), FVector(1, 3, 3), SH::Hex(TEXT("D4A73A")));
	}
	else if (Look.Hat == 2)
	{
		Part(Torso, Cyl, FVector(0, 0, 177.5f), FVector(44, 40, 1.5f), Look.HatColor);
		Part(Torso, Cyl, FVector(0, 0, 184), FVector(20, 19, 12), Look.HatColor);
		Part(Torso, Cyl, FVector(0, 0, 179), FVector(20.5f, 19.5f, 2), SH::Hex(TEXT("5A3A22")));
	}
	else if (Look.Hat == 3)
	{
		Part(Torso, Sph, FVector(-1, 0, 175), FVector(22, 21, 14), Look.HatColor);
		Part(Torso, Cube, FVector(11, 0, 174), FVector(11, 16, 1.2f), Look.HatColor);
	}
	if (Look.bBeads)
	{
		const TCHAR* BeadC[] = { TEXT("7A3FBF"), TEXT("2FA84F"), TEXT("E8C33A") };
		for (int32 K = 0; K < 10; ++K)
		{
			const float A = K / 10.f * 2.f * PI;
			Part(Torso, Sph, FVector(FMath::Cos(A) * 12.f + 3.f, FMath::Sin(A) * 14.f, 142.f - FMath::Max(0.f, FMath::Cos(A)) * 5.f), FVector(3, 3, 3), SH::Hex(BeadC[K % 3]));
		}
	}

	// legs
	const FLinearColor Thigh = Look.bSkirt ? Look.Skin : Look.Pants;
	auto Leg = [&](float Y, USceneComponent*& Hip, USceneComponent*& Knee)
	{
		Hip = Joint(Owner, Root, FVector(0, Y, 95));
		Part(Hip, Cyl, FVector(0, 0, -22), FVector(Look.bFemale ? 15.f : 16.5f, Look.bFemale ? 15.f : 16.5f, 42), Thigh);
		Knee = Joint(Owner, Hip, FVector(0, 0, -44));
		Part(Knee, Sph, FVector::ZeroVector, FVector(13.5f, 13.5f, 13.5f), Thigh);
		Part(Knee, Cyl, FVector(0, 0, -20), FVector(12.5f, 12.5f, 40), Look.bSkirt ? Look.Skin : Look.Pants);
		Part(Knee, Cube, FVector(5, 0, -46), FVector(26, 11, 9), Look.Shoes);
	};
	Leg(-9.5f * HipW, HipL, KneeL);
	Leg(9.5f * HipW, HipR, KneeR);

	// arms
	auto Arm = [&](float Y, USceneComponent*& Sh, USceneComponent*& El)
	{
		Sh = Joint(Owner, Root, FVector(0, Y, 143));
		Part(Sh, Sph, FVector::ZeroVector, FVector(12, 12, 12), Look.Shirt);
		if (Look.bShortSleeves)
		{
			Part(Sh, Cyl, FVector(0, 0, -8), FVector(11, 11, 14), Look.Shirt);
			Part(Sh, Cyl, FVector(0, 0, -21), FVector(9.5f, 9.5f, 16), Look.Skin);
		}
		else Part(Sh, Cyl, FVector(0, 0, -15), FVector(10.5f, 10.5f, 28), Look.Shirt);
		El = Joint(Owner, Sh, FVector(0, 0, -30));
		Part(El, Sph, FVector::ZeroVector, FVector(9, 9, 9), Look.bShortSleeves ? Look.Skin : Look.Shirt);
		Part(El, Cyl, FVector(0, 0, -14), FVector(8.5f, 8.5f, 26), Look.bShortSleeves ? Look.Skin : Look.Shirt);
		Part(El, Sph, FVector(1, 0, -29), FVector(6, 5, 9), Look.Skin);
	};
	Arm(-21.f * Bw, ShoulderL, ElbowL);
	Arm(21.f * Bw, ShoulderR, ElbowR);
	Gun = Part(ElbowR, Cube, FVector(7, 0, -30), FVector(20, 4, 7), SH::Hex(TEXT("1C1C1E")));
	Gun->SetVisibility(Look.bArmed);
	Animate(0.f, 0.f, false);
}

void FSHHumanRig::Animate(float Dt, float SpeedCmS, bool bAiming, bool bSwimming)
{
	if (!Root) return;
	const float Ms = SpeedCmS / 100.f;
	Phase += Dt * Ms * 3.1f;
	const float Amount = FMath::Clamp(Ms * 0.2f, 0.f, 0.95f);
	const float Run = FMath::Clamp(Amount / 0.9f, 0.f, 1.f);
	const float S = FMath::Sin(Phase) * Amount;
	const float Moving = Amount > 0.02f ? 1.f : 0.3f;
	HipL->SetRelativeRotation(FRotator(S * 50.f, 0.f, 0.f));
	HipR->SetRelativeRotation(FRotator(-S * 50.f, 0.f, 0.f));
	KneeL->SetRelativeRotation(FRotator(-(5.f + FMath::Max(0.f, FMath::Sin(Phase + 1.3f)) * (30.f + Run * 50.f)) * Moving, 0.f, 0.f));
	KneeR->SetRelativeRotation(FRotator(-(5.f + FMath::Max(0.f, FMath::Sin(Phase + 1.3f + PI)) * (30.f + Run * 50.f)) * Moving, 0.f, 0.f));
	ShoulderL->SetRelativeRotation(FRotator(-S * 42.f, 0.f, -4.f));
	ElbowL->SetRelativeRotation(FRotator(14.f + Run * 50.f, 0.f, 0.f));
	if (bAiming)
	{
		ShoulderR->SetRelativeRotation(FRotator(86.f, 0.f, 0.f));
		ElbowR->SetRelativeRotation(FRotator::ZeroRotator);
		ShoulderL->SetRelativeRotation(FRotator(72.f, 20.f, 0.f));
		ElbowL->SetRelativeRotation(FRotator(20.f, 0.f, 0.f));
	}
	else
	{
		ShoulderR->SetRelativeRotation(FRotator(S * 42.f, 0.f, 4.f));
		ElbowR->SetRelativeRotation(FRotator(14.f + Run * 50.f, 0.f, 0.f));
	}
	Torso->SetRelativeRotation(FRotator(0.f, bAiming ? 0.f : S * 7.f, 0.f));
	Root->SetRelativeLocation(FVector(0.f, 0.f, FMath::Abs(FMath::Cos(Phase)) * Amount * 5.f + (bSwimming ? 60.f : 0.f)));
	Root->SetRelativeRotation(FRotator(bSwimming ? -75.f : 0.f, 0.f, 0.f));
}

void FSHHumanRig::Punch(float T)
{
	if (ShoulderR) ShoulderR->SetRelativeRotation(FRotator(90.f * FMath::Sin(T * PI), 0.f, 0.f));
}

void FSHHumanRig::LieDown()
{
	if (!Root) return;
	Root->SetRelativeRotation(FRotator(-90.f, FMath::FRandRange(-20.f, 20.f), 0.f));
	Root->SetRelativeLocation(FVector(0.f, 0.f, 14.f));
	ShoulderL->SetRelativeRotation(FRotator(0.f, 0.f, -60.f));
	ShoulderR->SetRelativeRotation(FRotator(0.f, 0.f, 60.f));
	KneeL->SetRelativeRotation(FRotator(-20.f, 0.f, 0.f));
	if (Gun) Gun->SetVisibility(false);
}

void FSHHumanRig::StandUp()
{
	if (!Root) return;
	Root->SetRelativeRotation(FRotator::ZeroRotator);
	Root->SetRelativeLocation(FVector::ZeroVector);
}
